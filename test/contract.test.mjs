import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { relativePathFor, courseFolderName, sanitize, SECOND_YEAR_SUFFIXES } from '../lib/blackboard.mjs';
import {
  sharer, slug, zipFileName, selectCourses, isAllowed, dedupePaths, buildManifest, termOf, KIT_VERSION,
} from '../lib/contract.mjs';
import { loadAllowlist } from '../lib/collect.mjs';

test('root-level file sits directly in the course folder', () => {
  assert.equal(relativePathFor([], 'Syllabus.pdf'), 'Syllabus.pdf');
});

test('Materials path keeps Blackboard folders, sanitized, with no extra level', () => {
  assert.equal(
    relativePathFor(['Materials', 'Session 1: Understanding Your Reality.'], 'case.pdf'),
    'Materials/Session 1_ Understanding Your Reality/case.pdf');
});

test('names cannot climb out of the course folder', () => {
  assert.equal(relativePathFor(['..', 'Materials'], '../../evil.pdf'), 'Materials/evil.pdf');
  assert.equal(relativePathFor(['a/b'], 'x\\y.pdf'), 'a_b/y.pdf');
  assert.equal(relativePathFor([], 'con.pdf'), '_con.pdf');
});

test('course folder is the name between "MBA 2027 - " and the term suffix', () => {
  assert.equal(courseFolderName('MBA 2027 - Clubs Management - TF'), 'Clubs Management');
  assert.equal(courseFolderName('MBA 2027 - Entrepreneurship: New Ventures 1 - TF'), 'Entrepreneurship_ New Ventures 1');
  assert.equal(termOf('MBA 2027 - Clubs Management - TF'), 'TF');
  assert.deepEqual(SECOND_YEAR_SUFFIXES, [' - TF']);
});

test('second same-name file gets " (2)", then " (3)", case-insensitively', () => {
  assert.deepEqual(
    dedupePaths(['M/Case.pdf', 'M/case.PDF', 'M/Case.pdf', 'Other/Case.pdf', 'README', 'README']),
    ['M/Case.pdf', 'M/case (2).PDF', 'M/Case (3).pdf', 'Other/Case.pdf', 'README', 'README (2)']);
  assert.deepEqual(dedupePaths(['a (2).pdf', 'a.pdf', 'a.pdf']), ['a (2).pdf', 'a.pdf', 'a (3).pdf']);
});

test('sharer-id is the slugged first name plus 6 hex chars of sha256(user id)', () => {
  const hash = createHash('sha256').update('_100_1').digest('hex').slice(0, 6);
  assert.deepEqual(sharer('Ana María', '_100_1'), { firstName: 'Ana María', idHash: hash, sharerId: `ana-maria-${hash}` });
  assert.equal(sharer('', '_100_1').sharerId, `friend-${hash}`);
  assert.equal(slug('Entrepreneurship_ New Ventures 1'), 'entrepreneurship-new-ventures-1');
});

test('zip name follows <course_id>__<slug>__<sharer>__<date>.zip', () => {
  assert.equal(zipFileName('_8473_1', 'Clubs Management', 'ana-abc123', '2026-11-01'),
    '_8473_1__clubs-management__ana-abc123__2026-11-01.zip');
});

test('course filter keeps TF, drops NRB, organizations and known ids', () => {
  const courses = [
    { courseId: '_1_1', name: 'MBA 2027 - Clubs Management - TF', organization: false },
    { courseId: '_2_1', name: 'MBA 2027 - Corporate Finance - NRB', organization: false },
    { courseId: '_3_1', name: 'MBA 2027 - Class Community - TF', organization: true },
    { courseId: '_4_1', name: 'MBA 2027 - Negotiation 2 - TF', organization: false },
    { courseId: '_5_1', name: 'MBA 2027 - Negotiation 2 - TF extra', organization: false },
  ];
  assert.deepEqual(selectCourses(courses).map(c => c.courseId), ['_1_1', '_4_1']);
  assert.deepEqual(selectCourses(courses, { known: ['_4_1'] }).map(c => c.courseId), ['_1_1']);
  assert.deepEqual(selectCourses(courses, { courseFilter: 'negotiation' }).map(c => c.courseId), ['_4_1']);
});

test('allowlist holds exactly the shared extensions and matches case-insensitively', () => {
  const allow = loadAllowlist();
  assert.deepEqual(allow, ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'xlsm', 'ppt', 'pptx', 'csv', 'txt', 'md', 'png', 'jpg', 'jpeg']);
  assert.equal(isAllowed('Materials/Case.PDF', allow), true);
  assert.equal(isAllowed('Materials/Lecture.mp4', allow), false);
  assert.equal(isAllowed('Materials/noext', allow), false);
  assert.equal(isAllowed('Materials/.pdf', allow), false);
});

test('manifest carries the contract fields', () => {
  const m = buildManifest({
    course: { courseId: '_1_1', name: 'MBA 2027 - Clubs Management - TF' },
    sharedBy: { firstName: 'Ana', idHash: 'abc123' },
    files: [{ path: 'Materials/a.pdf', size: 3, sha256: 'ff', file: '/tmp/x' }],
    skipped: [{ path: 'Materials/v.mp4', reason: 'type not shared' }],
    createdAt: new Date('2026-11-01T10:00:00Z'),
  });
  assert.deepEqual(m, {
    kit_version: KIT_VERSION,
    course_name: 'MBA 2027 - Clubs Management - TF',
    course_id: '_1_1',
    term: 'TF',
    shared_by: { first_name: 'Ana', id_hash: 'abc123' },
    created_at: '2026-11-01T10:00:00.000Z',
    files: [{ path: 'Materials/a.pdf', size: 3, sha256: 'ff' }],
    skipped: [{ path: 'Materials/v.mp4', reason: 'type not shared' }],
  });
  assert.equal(sanitize('x. '), 'x');
});
