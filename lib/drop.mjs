// @ts-check
// Client for the library's upload drop: a web app that answers JSON after one redirect,
// and hands out resumable upload sessions (PUT in chunks with Content-Range).
import { openSync, readSync, closeSync, statSync } from 'node:fs';

export const CHUNK_SIZE = 8 * 1024 * 1024; // a multiple of 256 KiB, as the protocol requires
const MAX_FAILURES = 6;
const CHUNK_TIMEOUT_MS = 5 * 60 * 1000;

/** The drop refused a request; error is its code (bad_code, too_big, daily_limit, bad_request). */
export class DropError extends Error {
  constructor(error) {
    super(`upload drop refused: ${error}`);
    this.error = error;
  }
}

export async function dropCall(dropUrl, body) {
  // The drop answers with a redirect; fetch follows it with a GET, which is what it expects.
  const resp = await fetch(dropUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'follow',
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch {
    throw new Error(`the upload drop did not answer with JSON (HTTP ${resp.status})`);
  }
  if (!data.ok) throw new DropError(data.error || 'unknown');
  return data;
}

export async function knownCourseIds(dropUrl, code) {
  const data = await dropCall(dropUrl, { action: 'known', code });
  return Array.isArray(data.known_course_ids) ? data.known_course_ids : [];
}

/** Next offset from a 308 answer: "Range: bytes=0-n" means n+1 bytes are stored. */
function offsetFromRange(resp) {
  const match = /bytes=0-(\d+)/.exec(resp.headers.get('range') || '');
  return match ? Number(match[1]) + 1 : 0;
}

/** { done } | { expired } | { offset } for a session PUT answer. */
async function readAnswer(resp) {
  await resp.arrayBuffer().catch(() => {});
  if (resp.status === 200 || resp.status === 201) return { done: true };
  if (resp.status === 404 || resp.status === 410) return { expired: true };
  if (resp.status === 308) return { offset: offsetFromRange(resp) };
  throw new Error(`upload answered HTTP ${resp.status}`);
}

function queryStatus(sessionUri, total) {
  return fetch(sessionUri, {
    method: 'PUT',
    headers: { 'Content-Range': `bytes */${total}`, 'Content-Length': '0' },
    signal: AbortSignal.timeout(60000),
  }).then(readAnswer);
}

function putChunk(sessionUri, zipPath, start, end, total) {
  const body = Buffer.alloc(end - start);
  const fd = openSync(zipPath, 'r');
  try { readSync(fd, body, 0, body.length, start); } finally { closeSync(fd); }
  return fetch(sessionUri, {
    method: 'PUT',
    headers: { 'Content-Range': `bytes ${start}-${end - 1}/${total}` },
    body,
    signal: AbortSignal.timeout(CHUNK_TIMEOUT_MS),
  }).then(readAnswer);
}

/**
 * Uploads one zip, resuming from upload = { session_uri, offset, total } when given.
 * onState(upload | null) runs after every change so a killed run can resume.
 * Throws DropError when the drop refuses the start, Error after repeated network failures.
 */
export async function uploadZip({
  dropUrl, code, zipPath, courseId, sha256, upload = null,
  onState = () => {}, onProgress = () => {}, chunkSize = CHUNK_SIZE, retryDelayMs = 1000,
}) {
  const total = statSync(zipPath).size;
  const filename = zipPath.split(/[\\/]/).pop();
  let up = upload && upload.session_uri && upload.total === total ? { ...upload } : null;
  let fresh = false;
  let failures = 0;
  const save = async next => { up = next; await onState(next && { ...next }); };
  const expire = async () => {
    if (++failures > MAX_FAILURES) throw new Error('the upload session kept expiring');
    await save(null);
  };

  while (true) {
    try {
      if (!up) {
        const data = await dropCall(dropUrl, { action: 'start', code, filename, size: total, course_id: courseId, sha256 });
        await save({ session_uri: data.session_uri, offset: 0, total });
        fresh = true;
      } else if (!fresh) {
        const answer = await queryStatus(up.session_uri, total);
        if (answer.done) return { status: 'uploaded', total };
        if (answer.expired) { await expire(); continue; }
        await save({ ...up, offset: answer.offset });
      }
      fresh = false;
      while (up) {
        onProgress({ done: up.offset, total });
        const answer = await putChunk(up.session_uri, zipPath, up.offset, Math.min(up.offset + chunkSize, total), total);
        if (answer.done) {
          onProgress({ done: total, total });
          return { status: 'uploaded', total };
        }
        if (answer.expired) await expire();
        else await save({ ...up, offset: answer.offset });
      }
    } catch (e) {
      if (e instanceof DropError || ++failures > MAX_FAILURES) throw e;
      fresh = false;
      await new Promise(r => setTimeout(r, retryDelayMs * 2 ** Math.min(failures - 1, 5)));
    }
  }
}
