// @ts-check
// .state.json: { courses: { <course_id>: { course_name, zip, sha256, size, files, bytes,
//   skipped, upload: { session_uri, offset, total } | null, upload_result } } }
import { readFileSync, writeFileSync, renameSync } from 'node:fs';

export function loadState(path) {
  try {
    const state = JSON.parse(readFileSync(path, 'utf-8'));
    return { courses: state.courses || {} };
  } catch {
    return { courses: {} };
  }
}

/** Write-then-rename, so a run killed mid-write keeps the previous state. */
export function writeJson(path, value) {
  writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2));
  renameSync(`${path}.tmp`, path);
}

export const saveState = writeJson;

/** progress.json: { step, course, done, total, message, needs_friend }. */
export function makeProgress(path) {
  let current = { step: '', course: '', done: 0, total: 0, message: '', needs_friend: false, all_uploaded: false };
  return update => {
    current = { ...current, ...update };
    // A reader holding progress.json open makes the rename fail on Windows; progress is
    // advisory, so a failed write must not stop the run.
    try { writeJson(path, current); } catch {
      try { writeFileSync(path, JSON.stringify(current, null, 2)); } catch { /* next update retries */ }
    }
    return current;
  };
}
