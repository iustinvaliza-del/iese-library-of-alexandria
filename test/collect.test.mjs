import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';
import { collectWithClient } from '../lib/collect.mjs';
import { fixtureClient } from '../lib/fixture-client.mjs';
import { writeZip } from '../lib/zip.mjs';
import { sha256Hex, sharer, localDate } from '../lib/contract.mjs';
import { loadState, saveState } from '../lib/state.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'kit-test-'));

test('zip round trip: unzip gives back the inputs, including non-ASCII names', () => {
  const dir = tmp();
  try {
    const src = join(dir, 'src.bin');
    const big = Buffer.alloc(300000, 7);
    writeFileSync(src, big);
    const zipPath = join(dir, 'out.zip');
    writeZip(zipPath, [
      { name: 'Clubs Management/manifest.json', data: Buffer.from('{"a":1}') },
      { name: 'Clubs Management/Materials/Sesión 1/caso é.pdf', file: src },
    ]);
    const back = unzipSync(readFileSync(zipPath));
    assert.deepEqual(Object.keys(back).sort(), ['Clubs Management/Materials/Sesión 1/caso é.pdf', 'Clubs Management/manifest.json']);
    assert.ok(Buffer.from(back['Clubs Management/Materials/Sesión 1/caso é.pdf']).equals(big));
    assert.equal(strFromU8(back['Clubs Management/manifest.json']), '{"a":1}');
    assert.deepEqual(readdirSync(dir).sort(), ['out.zip', 'src.bin']); // no .partial left
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('collect zips each 2nd-year course per the contract', async () => {
  const out = tmp();
  try {
    const recorded = [];
    const { results, sharedBy } = await collectWithClient(fixtureClient(), { out, onCourse: r => recorded.push(r.course_id) });
    assert.deepEqual(results.map(r => r.course_id), ['_1_1', '_4_1']);
    assert.deepEqual(recorded, ['_1_1', '_4_1']);
    assert.deepEqual(sharedBy, sharer('Ana María', '_100_1'));

    const clubs = results[0];
    assert.equal(clubs.zip, join(out, `_1_1__clubs-management__${sharedBy.sharerId}__${localDate()}.zip`));
    const entries = unzipSync(readFileSync(clubs.zip));
    const session = 'Clubs Management/Materials/Session 1_ Understanding Your Reality';
    assert.deepEqual(Object.keys(entries).sort(), [
      `${session}/Case (3).pdf`,
      `${session}/Case.pdf`,
      `${session}/Numbers.xlsx`,
      `${session}/case (2).PDF`,
      'Clubs Management/Syllabus.pdf',
      'Clubs Management/manifest.json',
    ]);
    assert.equal(strFromU8(entries[`${session}/case (2).PDF`]), 'case two');
    assert.equal(strFromU8(entries[`${session}/Case (3).pdf`]), 'case three');

    const manifest = JSON.parse(strFromU8(entries['Clubs Management/manifest.json']));
    assert.equal(manifest.course_id, '_1_1');
    assert.equal(manifest.term, 'TF');
    assert.deepEqual(manifest.shared_by, { first_name: 'Ana María', id_hash: sharedBy.idHash });
    assert.deepEqual(manifest.files.find(f => f.path === 'Syllabus.pdf'),
      { path: 'Syllabus.pdf', size: 13, sha256: sha256Hex('syllabus body') });
    assert.equal(manifest.files.length, 5);
    assert.deepEqual(manifest.skipped, [{ path: 'Materials/Session 1_ Understanding Your Reality/Lecture.mp4', reason: 'type not shared' }]);
    assert.equal(clubs.sha256, sha256Hex(readFileSync(clubs.zip)));

    const ventures = results[1];
    assert.equal(ventures.files, 1);
    assert.deepEqual(ventures.skipped, [{ path: 'Missing.pdf', reason: 'download failed (HTTP 404)' }]);
    assert.ok(unzipSync(readFileSync(ventures.zip))['Entrepreneurship_ New Ventures 1/Reading.docx']);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('known course ids are not collected; dry run downloads nothing', async () => {
  const out = tmp();
  try {
    const { results } = await collectWithClient(fixtureClient(), { out, known: ['_1_1'], dry: true });
    assert.deepEqual(results.map(r => r.course_id), ['_4_1']);
    assert.deepEqual(results[0].files.map(f => f.path), ['Reading.docx', 'Missing.pdf']);
    assert.deepEqual(readdirSync(out), []);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('state file round trip; a missing or broken state file reads as empty', () => {
  const dir = tmp();
  try {
    const path = join(dir, '.state.json');
    assert.deepEqual(loadState(path), { courses: {} });
    writeFileSync(path, '{broken');
    assert.deepEqual(loadState(path), { courses: {} });
    const state = { courses: { _1_1: { zip: 'x.zip', sha256: 'ab', upload: { session_uri: 'http://u', offset: 262144, total: 9 } } } };
    saveState(path, state);
    assert.deepEqual(loadState(path), state);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('kit.mjs collect --dry lists the fixture courses and exits 0', () => {
  const kit = fileURLToPath(new URL('../kit.mjs', import.meta.url));
  const output = execFileSync(process.execPath, [kit, 'collect', '--dry'], { encoding: 'utf-8' });
  assert.match(output, /MBA 2027 - Clubs Management - TF \(_1_1\) -> folder "Clubs Management"/);
  assert.match(output, /- Materials\/Session 1_ Understanding Your Reality\/Lecture\.mp4 \(type not shared\)/);
  assert.doesNotMatch(output, /Corporate Finance|Class Community/);
});

test('kit.mjs upload with no drop configured says where the zips are and exits 0', () => {
  const kit = fileURLToPath(new URL('../kit.mjs', import.meta.url));
  assert.equal(JSON.parse(readFileSync(new URL('../kit.config.json', import.meta.url), 'utf-8')).dropUrl, '');
  const output = execFileSync(process.execPath, [kit, 'upload'], { encoding: 'utf-8' });
  assert.match(output, /^Upload drop not configured yet; your zips are in .*output$/m);
});
