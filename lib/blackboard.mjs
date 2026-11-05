// @ts-check
// Blackboard REST helpers. Content endpoints only: this kit never calls gradebook,
// attempts, users-list, announcements or messages endpoints.

export const BB_BASE = 'https://vc.iese.edu';
export const BB_API = `${BB_BASE}/learn/api/public/v1`;
export const BB_UI = `${BB_BASE}/ultra/course`;
const BB_HOST = new URL(BB_BASE).host;

/** Course names of 2nd-year terms end with one of these. */
export const SECOND_YEAR_SUFFIXES = [' - TF'];

export function isBlackboardUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.host === BB_HOST;
  } catch { return false; }
}

export function isLoggedIn(url) {
  return isBlackboardUrl(url) && !/login|saml/i.test(url);
}

/** API client that rides the browser context's cookie jar. */
export function makeClient(context, base = BB_API) {
  async function get(path, { params = {}, timeout = 30000 } = {}) {
    const resp = await context.request.get(base + path, {
      params,
      headers: { Accept: 'application/json' },
      timeout,
      maxRedirects: 5,
    });
    try {
      if (!resp.ok()) {
        const err = new Error(`HTTP ${resp.status()} ${path}`);
        // @ts-ignore -- status rides on the error for callers that branch on it
        err.status = resp.status();
        throw err;
      }
      return { data: await resp.json() };
    } finally {
      await resp.dispose().catch(() => {});
    }
  }

  /** Returns the file body as a Buffer. */
  async function download(path) {
    const resp = await context.request.get(base + path, { timeout: 120000, maxRedirects: 5 });
    try {
      if (!resp.ok()) {
        const err = new Error(`HTTP ${resp.status()} ${path}`);
        // @ts-ignore -- see get()
        err.status = resp.status();
        throw err;
      }
      return await resp.body();
    } finally {
      // Bodies stay in driver memory until disposed or the context closes.
      await resp.dispose().catch(() => {});
    }
  }

  return { get, download };
}

/** Paginated GET: Blackboard uses offset/limit pagination. */
export async function getAll(client, path, params = {}) {
  const results = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const { data } = await client.get(path, { params: { ...params, limit, offset } });
    const items = data.results || [];
    results.push(...items);
    if (!data.paging?.nextPage || items.length < limit) break;
    offset += limit;
  }
  return results;
}

export function sanitize(name) {
  // Windows keeps trailing dots/spaces on disk but strips them on lookup, so Explorer
  // cannot open such a folder: strip them at write time.
  return (name || 'Unknown')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 100);
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;
const MAX_STEM = 100;
const MAX_EXT = 16;

/** A Blackboard file name reduced to one safe Windows file name inside its folder. */
export function safeFileName(name) {
  let base = String(name ?? '').replace(/\\/g, '/');
  base = base.slice(base.lastIndexOf('/') + 1);
  base = [...base].filter(ch => ch.charCodeAt(0) > 0x1f).join('')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/, '');
  if (base === '' || base === '.' || base === '..') return 'file.bin';
  if (WINDOWS_RESERVED.test(base)) base = `_${base}`;
  const dot = base.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [base.slice(0, dot), base.slice(dot)] : [base, ''];
  return stem.slice(0, MAX_STEM) + ext.slice(0, MAX_EXT);
}

/**
 * Path of a file inside its course folder, forward slashes: <pathParts...>/<fileName>,
 * pathParts being the Blackboard folders, e.g. ['Materials', 'Session 5_ Media Moguls'].
 * Parts that sanitize to nothing are dropped, as path.resolve drops empty segments.
 * Throws if the path would leave the course folder: names come from the course author.
 */
export function relativePathFor(pathParts, fileName) {
  const parts = [...pathParts.map(sanitize).filter(Boolean), safeFileName(fileName)];
  if (parts.some(p => p === '.' || p === '..')) {
    throw new Error(`path outside the course folder: ${JSON.stringify(fileName)}`);
  }
  return parts.join('/');
}

/** The term suffix a course name ends with, or null if it is not a 2nd-year course. */
export function secondYearSuffix(name) {
  return SECOND_YEAR_SUFFIXES.find(s => String(name || '').endsWith(s)) ?? null;
}

/** Course folder: the name between "MBA 2027 - " and the term suffix, sanitized. */
export function courseFolderName(name) {
  const suffix = secondYearSuffix(name);
  const core = suffix ? name.slice(0, -suffix.length) : name;
  return sanitize(core.replace(/^MBA \d{4} - /, ''));
}

/**
 * Recursively walk a course's content tree.
 * Yields { courseId, contentId, attachmentId, fileName, pathParts[] } for each file.
 */
export async function* walkContents(client, courseId, parentId = null, pathParts = []) {
  const path = parentId
    ? `/courses/${courseId}/contents/${parentId}/children`
    : `/courses/${courseId}/contents`;

  let contents;
  try {
    contents = await getAll(client, path);
  } catch (e) {
    // Some folders return 403 (restricted): skip them.
    console.warn(`  [warn] ${path}: ${e.status || e.message}`);
    return;
  }

  for (const item of contents) {
    const handlerId = item.contentHandler?.id || '';
    const title = sanitize(item.title || 'Untitled');

    if (handlerId === 'resource/x-bb-file') {
      let attachments;
      try {
        attachments = await getAll(client, `/courses/${courseId}/contents/${item.id}/attachments`);
      } catch {
        continue;
      }
      for (const att of attachments) {
        yield {
          courseId,
          contentId: item.id,
          attachmentId: att.id,
          fileName: att.fileName || `${title}.bin`,
          pathParts: [...pathParts],
        };
      }
    } else if (
      handlerId === 'resource/x-bb-folder' ||
      handlerId === 'resource/x-bb-document' ||
      handlerId === '' ||
      item.hasChildren
    ) {
      yield* walkContents(client, courseId, item.id, [...pathParts, title]);
    }
  }
}

export function attachmentPath(courseId, contentId, attachmentId) {
  return `/courses/${courseId}/contents/${contentId}/attachments/${attachmentId}/download`;
}

/** The signed-in user: { id, givenName }. */
export async function currentUser(client) {
  try {
    const { data } = await client.get('/users/me');
    return { id: data.id, givenName: data.name?.given || '' };
  } catch (e) {
    throw new Error(`Failed to get user: ${e.message}`);
  }
}

/**
 * Enrolled courses: [{ courseId, name, organization }]. A course whose details cannot be
 * read keeps its id as its name, so the 2nd-year filter drops it.
 */
export async function enrolledCourses(client, userId) {
  const enrollments = await getAll(client, `/users/${userId}/courses`);
  const courses = [];
  for (const enrollment of enrollments) {
    const courseId = enrollment.courseId;
    if (!courseId) continue;
    try {
      const { data } = await client.get(`/courses/${courseId}`);
      courses.push({ courseId, name: data.name || data.courseId || courseId, organization: data.organization === true });
    } catch {
      courses.push({ courseId, name: courseId, organization: false });
    }
  }
  return courses;
}
