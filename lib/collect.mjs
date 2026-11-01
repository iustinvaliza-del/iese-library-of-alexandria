// @ts-check
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  makeClient, walkContents, relativePathFor, courseFolderName, attachmentPath,
  currentUser, enrolledCourses,
} from './blackboard.mjs';
import {
  sharer, selectCourses, isAllowed, dedupePaths, buildManifest, zipFileName, localDate, sha256Hex,
} from './contract.mjs';
import { writeZip, sha256File } from './zip.mjs';

export function loadAllowlist() {
  return JSON.parse(readFileSync(new URL('../allowlist.json', import.meta.url), 'utf-8'));
}

/**
 * Every file of one course, as it will sit in the zip: { folder, files, skipped }.
 * files: [{ path, contentId, attachmentId }], path relative to the course folder.
 */
export async function planCourse(client, course, allowlist) {
  const allowed = [];
  const skipped = [];
  for await (const item of walkContents(client, course.courseId)) {
    const path = relativePathFor(item.pathParts, item.fileName);
    if (isAllowed(path, allowlist)) allowed.push({ path, contentId: item.contentId, attachmentId: item.attachmentId });
    else skipped.push({ path, reason: 'type not shared' });
  }
  const unique = dedupePaths(allowed.map(f => f.path));
  allowed.forEach((f, i) => { f.path = unique[i]; });
  return { folder: courseFolderName(course.name), files: allowed, skipped };
}

/** Downloads one planned course into a temp dir and zips it into out. */
async function zipCourse(client, course, plan, { out, sharedBy, onProgress }) {
  const tmp = mkdtempSync(join(tmpdir(), 'alexandria-'));
  try {
    const files = [];
    const skipped = [...plan.skipped];
    for (const [i, f] of plan.files.entries()) {
      onProgress({ course: course.name, done: i, total: plan.files.length, message: `Downloading ${f.path}` });
      try {
        const body = await client.download(attachmentPath(course.courseId, f.contentId, f.attachmentId));
        const file = join(tmp, String(i));
        writeFileSync(file, body);
        files.push({ path: f.path, file, size: body.length, sha256: sha256Hex(body) });
      } catch (e) {
        skipped.push({ path: f.path, reason: `download failed (${e.status ? `HTTP ${e.status}` : e.message})` });
      }
    }
    onProgress({ course: course.name, done: plan.files.length, total: plan.files.length, message: 'Zipping' });
    const manifest = buildManifest({ course, sharedBy, files, skipped });
    mkdirSync(out, { recursive: true });
    const zipPath = join(out, zipFileName(course.courseId, plan.folder, sharedBy.sharerId, localDate()));
    writeZip(zipPath, [
      { name: `${plan.folder}/manifest.json`, data: Buffer.from(JSON.stringify(manifest, null, 2)) },
      ...files.map(f => ({ name: `${plan.folder}/${f.path}`, file: f.file })),
    ]);
    return {
      course_id: course.courseId,
      course_name: course.name,
      zip: zipPath,
      sha256: await sha256File(zipPath),
      size: statSync(zipPath).size,
      files: files.length,
      bytes: files.reduce((n, f) => n + f.size, 0),
      skipped,
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Collects the signed-in user's 2nd-year courses (minus known course ids) into one zip each.
 * With dry, nothing is downloaded: results hold each course's plan instead.
 * onCourse runs after each zip, so a caller can record it before the next course starts.
 */
export async function collectWithClient(client, {
  out, courseFilter = '', known = [], allowlist = loadAllowlist(), dry = false,
  onProgress = () => {}, onCourse = () => {},
}) {
  const user = await currentUser(client);
  const sharedBy = sharer(user.givenName, user.id);
  const courses = selectCourses(await enrolledCourses(client, user.id), { courseFilter, known });
  const results = [];
  for (const course of courses) {
    onProgress({ course: course.name, done: 0, total: 0, message: 'Listing files' });
    const plan = await planCourse(client, course, allowlist);
    if (dry) {
      results.push({ course_id: course.courseId, course_name: course.name, ...plan });
      continue;
    }
    const result = await zipCourse(client, course, plan, { out, sharedBy, onProgress });
    await onCourse(result);
    results.push(result);
  }
  return { sharedBy, courses, results };
}

/** collect(context, { out, courseFilter, known }) for a signed-in Playwright browser context. */
export function collect(context, options) {
  return collectWithClient(makeClient(context), options);
}
