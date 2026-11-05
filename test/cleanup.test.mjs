import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup, receiptText, statusLine } from '../kit.mjs';

const LIBRARY_LINE = "Your files are now in Radu's IESE course library on Google Drive. It is private for now; Radu will share access when it opens to everyone.";

function workFolder() {
  const dir = mkdtempSync(join(tmpdir(), 'kit-clean-'));
  for (const d of ['output', '.node', 'node_modules']) {
    mkdirSync(join(dir, d, 'sub'), { recursive: true });
    writeFileSync(join(dir, d, 'sub', 'f.bin'), 'x');
  }
  for (const f of ['.state.json', 'progress.json', 'receipt.txt']) writeFileSync(join(dir, f), '{}');
  writeFileSync(join(dir, 'kit.mjs'), '// kit file');
  return dir;
}

test('cleanup deletes what the kit created, tolerates missing parts, keeps kit files', () => {
  const dir = workFolder();
  try {
    // .browsers and .node-download are absent: a missing part is not an error.
    const left = cleanup(dir);
    assert.deepEqual(left, []);
    for (const p of ['output', '.node', 'node_modules', '.browsers', '.state.json', 'progress.json', 'receipt.txt']) {
      assert.equal(existsSync(join(dir, p)), false, p);
    }
    assert.equal(existsSync(join(dir, 'kit.mjs')), true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('cleanup reports exactly the paths a lock left behind', () => {
  const dir = workFolder();
  try {
    const locked = join(dir, '.node');
    const left = cleanup(dir, {
      remove: p => {
        if (p === locked) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
        rmSync(p, { recursive: true, force: true });
      },
    });
    assert.deepEqual(left, [locked]);
    assert.equal(existsSync(join(dir, 'output')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('cleanup does not trust a remove that returned without deleting', () => {
  const dir = workFolder();
  try {
    const left = cleanup(dir, { remove: () => {} });
    assert.ok(left.includes(join(dir, 'output')));
    assert.ok(left.includes(join(dir, '.state.json')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const course = upload_result => ({
  course_name: 'Clubs Management - TF', course_id: '_1_1', files: 2, bytes: 2048, size: 1024, skipped: [], upload_result,
});

test('the receipt names the library only when every course is uploaded', () => {
  assert.ok(receiptText({ a: course('uploaded'), b: course('uploaded') }).trimEnd().endsWith(LIBRARY_LINE));
  assert.ok(!receiptText({ a: course('uploaded'), b: course('not uploaded: daily_limit') }).includes(LIBRARY_LINE));
  assert.ok(!receiptText({}).includes(LIBRARY_LINE));
});

test('status lines use the fixed launcher wording', () => {
  const p = over => ({ step: '', message: '', needs_friend: false, all_uploaded: false, ...over });
  assert.equal(statusLine(p({ step: 'collect', needs_friend: true })), 'Sign in to Blackboard in the browser window that opened');
  assert.equal(statusLine(p({ step: 'collect', needs_friend: false })), 'Downloading your course files…');
  assert.equal(statusLine(p({ step: 'upload', message: 'Uploading' })), 'Uploading…');
  assert.equal(statusLine(p({ step: 'done', all_uploaded: true, message: 'Finished' })), 'Done: all uploaded');
  assert.equal(statusLine(p({ step: 'done', message: 'Finished with problems: see receipt.txt' })),
    'Stopped: Finished with problems: see receipt.txt; double-click Start again to continue');
  assert.equal(statusLine(p({ step: 'upload', message: 'Failed: network down' })),
    'Stopped: network down; double-click Start again to continue');
});
