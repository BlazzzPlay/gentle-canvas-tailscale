// Loopback reverse proxy in front of the gentle-design canvas.
//
// The canvas listens on a random loopback port with a random URL token and
// writes neither to disk. The token travels in every request path, so the
// proxy finds the canvas by probing loopback listeners for `GET /<token>/` and
// accepting only a 200 HTML page that contains `/<token>/` (a catch-all SPA
// answers 200 to any path, so status alone proves nothing). Every response the
// proxy sends carries PROXY_MARK, and its probes send it too: one copy never
// mistakes another copy for the canvas, and a probe never makes a copy search.
import { execFileSync } from 'node:child_process';
import http from 'node:http';

export const PROXY_MARK = 'x-canvas-proxy';
const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;
const NOT_FOUND = 'gentle-design canvas not found: open it (gentle_design open) and use its token path\n';

/** Loopback TCP listeners owned by this user (ss only names processes we own). */
export function userLoopbackPorts() {
  let out;
  try {
    out = execFileSync('ss', ['-ltnpH'], { encoding: 'utf8' });
  } catch {
    return [];
  }
  const ports = new Set();
  for (const line of out.split('\n')) {
    const m = line.match(/\s127\.0\.0\.1:(\d+)\s.*users:\(\(/);
    if (m) ports.add(Number(m[1]));
  }
  return [...ports];
}

function probe(port, token) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: `/${token}/`, headers: { host: `127.0.0.1:${port}`, [PROXY_MARK]: 'probe' }, timeout: 1000 }, (res) => {
      if (res.headers[PROXY_MARK] || res.statusCode !== 200 || !String(res.headers['content-type']).startsWith('text/html')) {
        res.resume();
        return resolve(false);
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { if (body.length < 65536) body += c; });
      res.on('end', () => resolve(body.includes(`/${token}/`)));
      res.on('error', () => resolve(false));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

/**
 * @param {{ listenPort?: number, publicOrigin: string, candidatePorts?: () => number[], onFound?: (port: number) => void }} options
 */
export function createCanvasProxy({ listenPort = 34316, publicOrigin, candidatePorts = userLoopbackPorts, onFound = () => {} }) {
  let upstream; // { port, token }
  let ownPort;

  async function discover(token) {
    const ports = candidatePorts().filter((p) => p !== ownPort);
    const hits = await Promise.all(ports.map((p) => probe(p, token)));
    const port = ports[hits.indexOf(true)];
    if (port === undefined) return undefined;
    upstream = { port, token };
    onFound(port);
    return upstream;
  }

  async function resolveUpstream(path) {
    const token = path.split('/')[1] ?? '';
    if (!TOKEN.test(token)) return upstream;
    if (upstream?.token === token && (await probe(upstream.port, token))) return upstream;
    return discover(token);
  }

  function forward(q, s, port) {
    const L = `http://127.0.0.1:${port}`;
    const h = { ...q.headers, host: `127.0.0.1:${port}` };
    delete h[PROXY_MARK];
    if (h.origin && h.origin !== 'null') h.origin = L;
    delete h.referer;
    const p = http.request({ host: '127.0.0.1', port, path: q.url, method: q.method, headers: h }, (r) => {
      const rh = { ...r.headers, [PROXY_MARK]: '1' };
      const csp = rh['content-security-policy'];
      if (csp) rh['content-security-policy'] = String(csp).replaceAll(L, `${L} ${publicOrigin}`);
      s.writeHead(r.statusCode, rh);
      r.pipe(s);
    });
    p.on('error', (e) => {
      upstream = undefined;
      if (!s.headersSent) s.writeHead(502, { [PROXY_MARK]: '1' });
      s.end(String(e));
    });
    q.pipe(p);
  }

  const server = http.createServer(async (q, s) => {
    if (q.headers[PROXY_MARK]) {
      s.writeHead(404, { [PROXY_MARK]: '1' });
      return s.end();
    }
    try {
      const up = await resolveUpstream(q.url ?? '/');
      if (!up) {
        s.writeHead(502, { 'content-type': 'text/plain', [PROXY_MARK]: '1' });
        return s.end(NOT_FOUND);
      }
      forward(q, s, up.port);
    } catch (e) {
      if (!s.headersSent) s.writeHead(500, { [PROXY_MARK]: '1' });
      s.end(String(e));
    }
  });
  server.requestTimeout = 0; // the canvas keeps an SSE stream open (/events)

  return {
    /** Starts listening on 127.0.0.1 and resolves with the bound port. */
    start() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(listenPort, '127.0.0.1', () => {
          server.off('error', reject);
          ownPort = server.address().port;
          resolve(ownPort);
        });
      });
    },
    /** Idempotent. */
    stop() {
      return new Promise((resolve) => {
        if (!server.listening) return resolve();
        server.closeAllConnections?.();
        server.close(() => resolve());
      });
    },
    get port() { return ownPort; },
    get canvasPort() { return upstream?.port; },
  };
}
