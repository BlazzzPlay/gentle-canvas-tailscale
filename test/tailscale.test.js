import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publicUrlFor, resolveExposure } from '../src/tailscale.js';

const status = { Self: { DNSName: 'box.tailnet.ts.net.' } };
const serve = (extra = {}) => ({
  Web: { 'box.tailnet.ts.net:8450': { Handlers: { '/': { Proxy: 'http://127.0.0.1:34316' } } } },
  ...extra,
});

test('finds the public origin that tailscale serve maps to the proxy port', () => {
  assert.deepEqual(resolveExposure({ status, serve: serve(), proxyPort: 34316 }), { ok: true, publicOrigin: 'https://box.tailnet.ts.net:8450', host: 'box.tailnet.ts.net' });
});

test('accepts proxy targets written as localhost or a bare port', () => {
  for (const target of ['http://localhost:34316', '34316', 'http://127.0.0.1:34316/']) {
    const s = { Web: { 'box.tailnet.ts.net:9000': { Handlers: { '/': { Proxy: target } } } } };
    assert.equal(resolveExposure({ status, serve: s, proxyPort: 34316 }).publicOrigin, 'https://box.tailnet.ts.net:9000', target);
  }
});

test('port 443 gives an origin without port', () => {
  const s = { Web: { 'box.tailnet.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:34316' } } } } };
  assert.equal(resolveExposure({ status, serve: s, proxyPort: 34316 }).publicOrigin, 'https://box.tailnet.ts.net');
});

test('refuses when tailscale funnel exposes the proxy to the internet', () => {
  const r = resolveExposure({ status, serve: serve({ AllowFunnel: { 'box.tailnet.ts.net:8450': true } }), proxyPort: 34316 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'funnel');
  assert.match(r.message, /tailscale funnel/);
});

test('without a serve mapping it explains the exact command to run', () => {
  const r = resolveExposure({ status, serve: {}, proxyPort: 34316, publicPort: 8450 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-serve');
  assert.match(r.message, /tailscale serve --bg --https=8450 http:\/\/127\.0\.0\.1:34316/);
});

test('without tailscale it says so', () => {
  const r = resolveExposure({ status: undefined, serve: undefined, proxyPort: 34316 });
  assert.deepEqual([r.ok, r.reason], [false, 'no-tailscale']);
});

test('publicUrlFor swaps the loopback origin of a canvas URL', () => {
  assert.equal(publicUrlFor('http://127.0.0.1:37643/tok_tok_tok_tok_tok/d/site/', 'https://box.tailnet.ts.net:8450'), 'https://box.tailnet.ts.net:8450/tok_tok_tok_tok_tok/d/site/');
  assert.equal(publicUrlFor('not a url', 'https://x'), undefined);
});

// Funnel on ANY entry that reaches the proxy must refuse, not only the first
// serve mapping: other Web entries, non-root path handlers and TCP forwards.
const P = 'http://127.0.0.1:34316';
for (const [name, serve] of Object.entries({
  'funnel on a second Web entry': { Web: { 'box.tailnet.ts.net:8450': { Handlers: { '/': { Proxy: P } } }, 'box.tailnet.ts.net:443': { Handlers: { '/': { Proxy: P } } } }, AllowFunnel: { 'box.tailnet.ts.net:443': true } },
  'funnel on a non-root path handler': { Web: { 'box.tailnet.ts.net:8450': { Handlers: { '/': { Proxy: P } } }, 'box.tailnet.ts.net:443': { Handlers: { '/c': { Proxy: P + '/' } } } }, AllowFunnel: { 'box.tailnet.ts.net:443': true } },
  'funnel on a TCP forward': { TCP: { '443': { TCPForward: '127.0.0.1:34316' } }, Web: { 'box.tailnet.ts.net:8450': { Handlers: { '/': { Proxy: P } } } }, AllowFunnel: { 'box.tailnet.ts.net:443': true } },
})) {
  test(`refuses: ${name}`, () => {
    const r = resolveExposure({ status, serve, proxyPort: 34316 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'funnel');
    assert.match(r.message, /box\.tailnet\.ts\.net:443 is exposed to the internet with tailscale funnel/);
  });
}

test('funnel on an unrelated port does not block', () => {
  const s = { Web: { 'box.tailnet.ts.net:8450': { Handlers: { '/': { Proxy: P } } }, 'box.tailnet.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:3000' } } } }, AllowFunnel: { 'box.tailnet.ts.net:443': true } };
  assert.equal(resolveExposure({ status, serve: s, proxyPort: 34316 }).publicOrigin, 'https://box.tailnet.ts.net:8450');
});

// Foreground sessions (`tailscale funnel 34316` without --bg) keep their config
// under Foreground.<session>; and any target spelling that reaches the proxy
// port on a local address counts.
test('refuses: foreground funnel session', () => {
  const fg = { Web: { 'box.tailnet.ts.net:8450': { Handlers: { '/': { Proxy: P } } } }, Foreground: { s1: { TCP: { '443': { HTTPS: true } }, Web: { 'box.tailnet.ts.net:443': { Handlers: { '/': { Proxy: P } } } }, AllowFunnel: { 'box.tailnet.ts.net:443': true } } } };
  assert.equal(resolveExposure({ status, serve: fg, proxyPort: 34316 }).reason, 'funnel');
});

test('refuses: foreground TCP forward under top-level funnel', () => {
  const fg = { Web: { 'box.tailnet.ts.net:8450': { Handlers: { '/': { Proxy: P } } } }, AllowFunnel: { 'box.tailnet.ts.net:443': true }, Foreground: { s1: { TCP: { '443': { TCPForward: '0.0.0.0:34316' } } } } };
  assert.equal(resolveExposure({ status, serve: fg, proxyPort: 34316 }).reason, 'funnel');
});

for (const target of ['http://0.0.0.0:34316', 'http://127.0.0.1:34316/x', 'HTTP://LOCALHOST:34316', 'http://[::1]:34316', 'https+insecure://127.0.0.1:34316', 'http://127.1.2.3:34316', 'localhost:34316', '34316']) {
  test(`refuses funnel via ${target}`, () => {
    const serve = { Web: { 'box.tailnet.ts.net:8450': { Handlers: { '/': { Proxy: P } } }, 'box.tailnet.ts.net:443': { Handlers: { '/': { Proxy: target } } } }, AllowFunnel: { 'box.tailnet.ts.net:443': true } };
    assert.equal(resolveExposure({ status, proxyPort: 34316, serve }).reason, 'funnel');
  });
}

test('a remote host on the same port is not the proxy', () => {
  const serve = { Web: { 'box.tailnet.ts.net:8450': { Handlers: { '/': { Proxy: 'http://10.0.0.5:34316' } } } } };
  assert.equal(resolveExposure({ status, proxyPort: 34316, serve }).reason, 'no-serve');
});

for (const target of ['http://[::ffff:127.0.0.1]:34316', 'http://[::ffff:0.0.0.0]:34316', 'http://[::ffff:7f00:1]:34316']) {
  test(`refuses funnel via IPv4-mapped ${target}`, () => {
    const serve = { Web: { 'box.tailnet.ts.net:8450': { Handlers: { '/': { Proxy: P } } }, 'box.tailnet.ts.net:443': { Handlers: { '/': { Proxy: target } } } }, AllowFunnel: { 'box.tailnet.ts.net:443': true } };
    assert.equal(resolveExposure({ status, proxyPort: 34316, serve }).reason, 'funnel');
  });
}
