// Imitates the library's upload drop: POST answers with a 302 to a JSON page (as Apps
// Script does), and session URIs follow the resumable upload protocol.
import { createServer } from 'node:http';

export const GOOD_CODE = 'good-code';
export const LIMIT_CODE = 'limit-code';
export const KNOWN_IDS = ['_9_1'];

/**
 * options: maxSize (bigger start -> too_big), dropAtByte (first PUT whose range covers this
 * byte loses its connection halfway), expireOnce (first PUT on a session answers 404).
 */
export async function startDropServer({ maxSize = Infinity, dropAtByte = null, expireOnce = false } = {}) {
  const answers = new Map();
  const sessions = new Map();
  const log = { starts: 0, puts: [], bytesReceived: 0, dropped: false, expired: false };
  let nextId = 1;

  function answerFor(body) {
    if (body.action === 'known') {
      return body.code === GOOD_CODE || body.code === LIMIT_CODE
        ? { ok: true, known_course_ids: KNOWN_IDS } : { ok: false, error: 'bad_code' };
    }
    if (body.action !== 'start') return { ok: false, error: 'bad_request' };
    if (body.code === LIMIT_CODE) return { ok: false, error: 'daily_limit' };
    if (body.code !== GOOD_CODE) return { ok: false, error: 'bad_code' };
    if (!body.filename || !Number.isInteger(body.size) || !body.course_id || !body.sha256) {
      return { ok: false, error: 'bad_request' };
    }
    if (body.size > maxSize) return { ok: false, error: 'too_big' };
    const id = String(nextId++);
    sessions.set(id, { ...body, chunks: [], committed: 0, fresh: true });
    log.starts++;
    return { ok: true, session_uri: `${base}/upload/${id}` };
  }

  function rangeHeaders(session) {
    return session.committed > 0 ? { Range: `bytes=0-${session.committed - 1}` } : {};
  }

  function handlePut(req, res, session) {
    const header = req.headers['content-range'] || '';
    const status = /^bytes \*\/(\d+)$/.exec(header);
    const chunk = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(header);
    if (expireOnce && !log.expired) {
      log.expired = true;
      req.resume();
      res.writeHead(404).end();
      return;
    }
    if (status) {
      req.resume();
      if (session.committed === session.size) res.writeHead(200).end('{}');
      else res.writeHead(308, rangeHeaders(session)).end();
      return;
    }
    if (!chunk || Number(chunk[1]) !== session.committed) {
      req.resume();
      res.writeHead(400).end('bad range');
      return;
    }
    const [start, end] = [Number(chunk[1]), Number(chunk[2])];
    log.puts.push([start, end]);
    const loseIt = dropAtByte !== null && !log.dropped && start <= dropAtByte && dropAtByte <= end;
    const parts = [];
    let seen = 0;
    req.on('data', part => {
      seen += part.length;
      log.bytesReceived += part.length;
      parts.push(part);
      if (loseIt && seen > (end - start + 1) / 2) {
        log.dropped = true;
        req.socket.destroy();
      }
    });
    req.on('end', () => {
      if (loseIt) return;
      const body = Buffer.concat(parts);
      if (body.length !== end - start + 1) { res.writeHead(400).end('length'); return; }
      session.chunks.push(body);
      session.committed = end + 1;
      if (session.committed === session.size) res.writeHead(200).end('{"id":"file"}');
      else res.writeHead(308, rangeHeaders(session)).end();
    });
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url, base);
    if (req.method === 'POST' && url.pathname === '/exec') {
      const parts = [];
      req.on('data', p => parts.push(p));
      req.on('end', () => {
        let body;
        try { body = JSON.parse(Buffer.concat(parts).toString('utf-8')); } catch { body = {}; }
        const token = String(answers.size + 1);
        answers.set(token, answerFor(body));
        res.writeHead(302, { Location: `${base}/echo/${token}` }).end();
      });
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/echo/')) {
      const answer = answers.get(url.pathname.slice('/echo/'.length));
      res.writeHead(answer ? 200 : 404, { 'Content-Type': 'application/json' }).end(JSON.stringify(answer || {}));
      return;
    }
    if (req.method === 'PUT' && url.pathname.startsWith('/upload/')) {
      const session = sessions.get(url.pathname.slice('/upload/'.length));
      if (!session) { req.resume(); res.writeHead(404).end(); return; }
      handlePut(req, res, session);
      return;
    }
    req.resume();
    res.writeHead(404).end();
  });

  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    dropUrl: `${base}/exec`,
    log,
    sessions,
    stored: id => Buffer.concat(sessions.get(id).chunks),
    close: () => new Promise(r => { server.closeAllConnections(); server.close(r); }),
  };
}
