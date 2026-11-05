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
