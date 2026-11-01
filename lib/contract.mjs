// @ts-check
// The zip contract shared with the library's unpack script: names, manifest, filters.
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { sanitize, secondYearSuffix } from './blackboard.mjs';

export const KIT_VERSION = '1.0.0';

export function slug(text) {
  return String(text || '')
    .normalize('NFKD').replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

/** sharer-id = slugged first name + "-" + first 6 hex chars of sha256(Blackboard user id). */
export function sharer(givenName, userId) {
  const idHash = sha256Hex(String(userId)).slice(0, 6);
  const firstName = String(givenName || '').trim();
  return { firstName, idHash, sharerId: `${slug(firstName) || 'friend'}-${idHash}` };
}

/** YYYY-MM-DD in the computer's local time zone. */
export function localDate(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function zipFileName(courseId, folder, sharerId, date) {
  return `${courseId}__${slug(folder) || 'course'}__${sharerId}__${date}.zip`;
}

/** Term code from the suffix, e.g. " - TF" -> "TF". */
export function termOf(name) {
  const suffix = secondYearSuffix(name);
  return suffix ? suffix.replace(/^\s*-\s*/, '').trim() : '';
}

/**
 * The courses to share: 2nd-year names, not organizations, not already known to the
 * library, and (when courseFilter is set) whose sanitized name contains it.
 */
export function selectCourses(courses, { courseFilter = '', known = [] } = {}) {
  const knownIds = new Set(known);
  const wanted = courseFilter.toLowerCase();
  return courses.filter(c =>
    secondYearSuffix(c.name) !== null
    && c.organization !== true
    && !knownIds.has(c.courseId)
    && (!wanted || sanitize(c.name).toLowerCase().includes(wanted)));
}

export function extensionOf(path) {
  const base = posix.basename(path);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function isAllowed(path, allowlist) {
  return allowlist.includes(extensionOf(path));
}

/**
 * Same-name files in one folder: the second gets " (2)" before the extension, then " (3)".
 * Names compare case-insensitively, as Windows and macOS file systems do.
 */
export function dedupePaths(paths) {
  const taken = new Set();
  return paths.map(path => {
    let candidate = path;
    const dir = posix.dirname(path);
    const base = posix.basename(path);
    const dot = base.lastIndexOf('.');
    const [stem, ext] = dot > 0 ? [base.slice(0, dot), base.slice(dot)] : [base, ''];
    for (let n = 2; taken.has(candidate.toLowerCase()); n++) {
      candidate = (dir === '.' ? '' : `${dir}/`) + `${stem} (${n})${ext}`;
    }
    taken.add(candidate.toLowerCase());
    return candidate;
  });
}

export function buildManifest({ course, sharedBy, files, skipped, createdAt = new Date() }) {
  return {
    kit_version: KIT_VERSION,
    course_name: course.name,
    course_id: course.courseId,
    term: termOf(course.name),
    shared_by: { first_name: sharedBy.firstName, id_hash: sharedBy.idHash },
    created_at: createdAt.toISOString(),
    files: files.map(f => ({ path: f.path, size: f.size, sha256: f.sha256 })),
    skipped: skipped.map(s => ({ path: s.path, reason: s.reason })),
  };
}
