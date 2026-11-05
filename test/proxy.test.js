// The proxy must reach the real canvas by its token, never a SPA that answers
// 200 HTML to any path, and never another copy of itself (which serves the same
// canvas page); a probe from one copy must not make another copy search.
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, test } from 'node:test';
import { createCanvasProxy, PROXY_MARK } from '../src/proxy.js';

const TOKEN = 'testtoken_' + Math.random().toString(36).slice(2, 14).padEnd(12, 'x');
const PUB = 'https://example-host.tailnet.ts.net:8450';
const cleanup = [];
after(async () => { for (const fn of cleanup) await fn(); });

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler).listen(0, '127.0.0.1', () => {
      cleanup.push(() => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }));
      resolve(server.address().port);
    });
  });
}

function get(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path, headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

async function startProxy(candidates) {
  const found = [];
  const proxy = createCanvasProxy({ listenPort: 0, publicOrigin: PUB, candidatePorts: () => candidates(), onFound: (p) => found.push(p) });
  const port = await proxy.start();
  cleanup.push(() => proxy.stop());
  return { proxy, port, found };
}

const canvasPort = await listen((q, s) => {
  if (q.url === `/${TOKEN}/`) {
    s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return s.end(`<script>{"base":"/${TOKEN}/"}</script>fake-canvas`);
  }
  if (q.url === `/${TOKEN}/files/a.html`) {
    s.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': `default-src 'self'; frame-ancestors http://127.0.0.1:${canvasPortRef.port} http://localhost:${canvasPortRef.port}` });
    return s.end('artboard');
  }
  if (q.url === `/${TOKEN}/echo`) {
    s.writeHead(200, { 'content-type': 'application/json' });
    return s.end(JSON.stringify({ host: q.headers.host, origin: q.headers.origin ?? null, referer: q.headers.referer ?? null, mark: q.headers[PROXY_MARK] ?? null }));
  }
  s.writeHead(404, { 'content-type': 'application/json' });
  s.end('{"error":"not-found"}');
});
const canvasPortRef = { port: canvasPort };
const spaPort = await listen((q, s) => {
  s.writeHead(200, { 'content-type': 'text/html' });
  s.end('<html>spa</html>');
});

test('finds the canvas by token, never a catch-all SPA nor another proxy copy', async () => {
  const a = await startProxy(() => [spaPort, canvasPort]);
  const viaA = await get(a.port, `/${TOKEN}/`);
  assert.equal(viaA.status, 200);
  assert.match(viaA.body, /fake-canvas/);
  assert.deepEqual(a.found, [canvasPort]);

  // A serves the canvas page for TOKEN; B sees A as a candidate and must skip it.
  const b = await startProxy(() => [a.port, spaPort, canvasPort]);
  const viaB = await get(b.port, `/${TOKEN}/`);
  assert.equal(viaB.status, 200);
  assert.match(viaB.body, /fake-canvas/);
  assert.deepEqual(b.found, [canvasPort]);
  assert.deepEqual(a.found, [canvasPort], "B's probe never made A search again");
});

test('rewrites Host and Origin, drops Referer and adds the public origin to the CSP', async () => {
  const p = await startProxy(() => [canvasPort]);
  const echo = await get(p.port, `/${TOKEN}/echo`, { origin: PUB, referer: `${PUB}/x` });
  assert.deepEqual(JSON.parse(echo.body), { host: `127.0.0.1:${canvasPort}`, origin: `http://127.0.0.1:${canvasPort}`, referer: null, mark: null });
  const art = await get(p.port, `/${TOKEN}/files/a.html`);
  assert.equal(art.headers['content-security-policy'], `default-src 'self'; frame-ancestors http://127.0.0.1:${canvasPort} ${PUB} http://localhost:${canvasPort}`);
  assert.equal(art.headers[PROXY_MARK], '1');
});

test('unknown token answers 502 with a hint', async () => {
  const p = await startProxy(() => [spaPort, canvasPort]);
  const res = await get(p.port, '/unknownunknownunknown00/');
  assert.equal(res.status, 502);
  assert.equal(res.body, 'gentle-design canvas not found: open it (gentle_design open) and use its token path\n');
  assert.deepEqual(p.found, []);
});

test('a marked probe gets 404 without discovery', async () => {
  const p = await startProxy(() => [canvasPort]);
  const res = await get(p.port, `/${TOKEN}/`, { [PROXY_MARK]: 'probe' });
  assert.equal(res.status, 404);
  assert.deepEqual(p.found, []);
});
