import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { startDropServer, GOOD_CODE, LIMIT_CODE, KNOWN_IDS } from './fixtures/drop-server.mjs';
import { knownCourseIds, uploadZip, dropCall, DropError, CHUNK_SIZE } from '../lib/drop.mjs';
import { loadState, saveState } from '../lib/state.mjs';

const MiB = 1024 * 1024;

function withZip(size, fn) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kit-up-'));
    const zipPath = join(dir, '_1_1__clubs-management__ana-abc123__2026-11-01.zip');
    const data = randomBytes(size);
    writeFileSync(zipPath, data);
    const sha256 = createHash('sha256').update(data).digest('hex');
    try { await fn({ dir, zipPath, data, sha256 }); } finally { rmSync(dir, { recursive: true, force: true }); }
  };
}

test('chunks are 8 MiB, a multiple of 256 KiB', () => {
  assert.equal(CHUNK_SIZE, 8 * MiB);
  assert.equal(CHUNK_SIZE % (256 * 1024), 0);
});

test('known follows the 302 hop and returns the known ids; a bad code is refused', async () => {
  const drop = await startDropServer();
  try {
    assert.deepEqual(await knownCourseIds(drop.dropUrl, GOOD_CODE), KNOWN_IDS);
    await assert.rejects(knownCourseIds(drop.dropUrl, 'nope'), e => e instanceof DropError && e.error === 'bad_code');
  } finally { await drop.close(); }
});

test('start errors surface as DropError codes', withZip(1000, async ({ zipPath, sha256 }) => {
  const drop = await startDropServer({ maxSize: 500 });
  try {
    const args = { dropUrl: drop.dropUrl, zipPath, courseId: '_1_1', sha256, retryDelayMs: 1 };
    for (const [code, error] of [['nope', 'bad_code'], [LIMIT_CODE, 'daily_limit'], [GOOD_CODE, 'too_big']]) {
      await assert.rejects(uploadZip({ ...args, code }), e => e instanceof DropError && e.error === error);
    }
    await assert.rejects(dropCall(drop.dropUrl, { action: 'start', code: GOOD_CODE }), e => e.error === 'bad_request');
  } finally { await drop.close(); }
}));

test('upload sends 8 MiB chunks and survives a dropped connection mid-file', withZip(20 * MiB + 123, async ({ zipPath, data, sha256 }) => {
  const drop = await startDropServer({ dropAtByte: 12 * MiB });
  try {
    const states = [];
    const result = await uploadZip({
      dropUrl: drop.dropUrl, code: GOOD_CODE, zipPath, courseId: '_1_1', sha256,
      onState: s => states.push(s), retryDelayMs: 5,
    });
    assert.equal(result.status, 'uploaded');
    assert.equal(drop.log.dropped, true);
    assert.equal(drop.log.starts, 1);
    assert.ok(drop.stored('1').equals(data));
    assert.deepEqual(drop.log.puts, [[0, 8 * MiB - 1], [8 * MiB, 16 * MiB - 1], [8 * MiB, 16 * MiB - 1], [16 * MiB, data.length - 1]]);
    assert.equal(states.at(-1).offset, 16 * MiB);
    assert.equal(drop.sessions.get('1').sha256, sha256);
  } finally { await drop.close(); }
}));

test('a killed run resumes from the state file without resending stored bytes', withZip(3 * MiB + 7, async ({ dir, zipPath, data, sha256 }) => {
  const drop = await startDropServer();
  const chunk = 1024 * 1024;
  try {
    // First run: start and send one chunk, saving state as kit.mjs does, then "die".
    const { session_uri } = await dropCall(drop.dropUrl, { action: 'start', code: GOOD_CODE, filename: 'z.zip', size: data.length, course_id: '_1_1', sha256 });
    const first = await fetch(session_uri, { method: 'PUT', headers: { 'Content-Range': `bytes 0-${chunk - 1}/${data.length}` }, body: data.subarray(0, chunk) });
    assert.equal(first.status, 308);
    const statePath = join(dir, '.state.json');
    saveState(statePath, { courses: { _1_1: { zip: zipPath, upload: { session_uri, offset: 0, total: data.length } } } });

    // Second run: offset in the file is stale (0); the session status says 1 MiB is stored.
    const state = loadState(statePath);
    const before = drop.log.bytesReceived;
    const result = await uploadZip({
      dropUrl: drop.dropUrl, code: GOOD_CODE, zipPath, courseId: '_1_1', sha256,
      upload: state.courses._1_1.upload, chunkSize: chunk,
      onState: s => { state.courses._1_1.upload = s; saveState(statePath, state); },
    });
    assert.equal(result.status, 'uploaded');
    assert.equal(drop.log.starts, 1);
    assert.equal(drop.log.bytesReceived - before, data.length - chunk);
    assert.ok(drop.stored('1').equals(data));
    assert.equal(JSON.parse(readFileSync(statePath, 'utf-8')).courses._1_1.upload.offset, 3 * chunk);
  } finally { await drop.close(); }
}));

test('an expired session (404) starts a new one', withZip(600 * 1024, async ({ zipPath, data, sha256 }) => {
  const drop = await startDropServer({ expireOnce: true });
  try {
    const result = await uploadZip({ dropUrl: drop.dropUrl, code: GOOD_CODE, zipPath, courseId: '_1_1', sha256, chunkSize: 256 * 1024 });
    assert.equal(result.status, 'uploaded');
    assert.equal(drop.log.starts, 2);
    assert.ok(drop.stored('2').equals(data));
  } finally { await drop.close(); }
}));
