import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createController } from '../src/controller.js';

const okTs = { status: { Self: { DNSName: 'box.tailnet.ts.net.' } }, serve: { Web: { 'box.tailnet.ts.net:8450': { Handlers: { '/': { Proxy: 'http://127.0.0.1:34316' } } } } } };

function fakeProxyFactory(log) {
  return (opts) => ({
    async start() { log.push(['start', opts.listenPort, opts.publicOrigin]); return opts.listenPort; },
    async stop() { log.push(['stop']); },
  });
}

test('start serves the tailnet origin and reports the public canvas URL', async () => {
  const log = [];
  const c = createController({ proxyPort: 34316, readTailscale: async () => okTs, createProxy: fakeProxyFactory(log) });
  c.recordCanvasUrl('http://127.0.0.1:37643/tok_tok_tok_tok_tok/d/site/');
  const r = await c.start();
  assert.deepEqual(log, [['start', 34316, 'https://box.tailnet.ts.net:8450']]);
  assert.deepEqual(r, { level: 'info', text: 'Canvas on your tailnet: https://box.tailnet.ts.net:8450/tok_tok_tok_tok_tok/d/site/' });
  assert.deepEqual(await c.start(), r, 'start twice does not start a second proxy');
  assert.equal(log.length, 1);
});

test('start without a known canvas URL tells how to get one', async () => {
  const c = createController({ proxyPort: 34316, readTailscale: async () => okTs, createProxy: fakeProxyFactory([]) });
  assert.deepEqual(await c.start(), { level: 'info', text: 'Proxy ready on https://box.tailnet.ts.net:8450. Open a design (gentle_design open or /gentle:design) to get its tailnet URL.' });
});

test('refuses to start under tailscale funnel', async () => {
  const log = [];
  const ts = { ...okTs, serve: { ...okTs.serve, AllowFunnel: { 'box.tailnet.ts.net:8450': true } } };
  const c = createController({ proxyPort: 34316, readTailscale: async () => ts, createProxy: fakeProxyFactory(log) });
  const r = await c.start();
  assert.equal(r.level, 'error');
  assert.match(r.text, /tailscale funnel/);
  assert.deepEqual(log, []);
});

test('without a serve mapping it does not start and prints the setup command', async () => {
  const log = [];
  const c = createController({ proxyPort: 34316, publicPort: 8450, readTailscale: async () => ({ ...okTs, serve: {} }), createProxy: fakeProxyFactory(log) });
  const r = await c.start();
  assert.equal(r.level, 'warning');
  assert.match(r.text, /tailscale serve --bg --https=8450 http:\/\/127\.0\.0\.1:34316/);
  assert.deepEqual(log, []);
});

test('a new canvas URL while running yields its public URL; stop is idempotent', async () => {
  const log = [];
  const c = createController({ proxyPort: 34316, readTailscale: async () => okTs, createProxy: fakeProxyFactory(log) });
  assert.equal(c.recordCanvasUrl('http://127.0.0.1:1/aaaaaaaaaaaaaaaaaaaa/'), undefined, 'not running: nothing to announce');
  await c.start();
  assert.equal(c.recordCanvasUrl('http://127.0.0.1:2/bbbbbbbbbbbbbbbbbbbb/d/x/'), 'https://box.tailnet.ts.net:8450/bbbbbbbbbbbbbbbbbbbb/d/x/');
  assert.deepEqual(await c.stop(), { level: 'info', text: 'Canvas proxy stopped.' });
  assert.deepEqual(await c.stop(), { level: 'info', text: 'Canvas proxy is not running.' });
  assert.deepEqual(log.at(-1), ['stop']);
  assert.equal(log.filter((e) => e[0] === 'stop').length, 1);
});

test('status reports state without starting anything', async () => {
  const log = [];
  const c = createController({ proxyPort: 34316, readTailscale: async () => okTs, createProxy: fakeProxyFactory(log) });
  assert.deepEqual(c.status(), { level: 'info', text: 'Canvas proxy is not running. Start it with /canvas:tailscale.' });
  await c.start();
  assert.deepEqual(c.status(), { level: 'info', text: 'Proxy running on 127.0.0.1:34316 behind https://box.tailnet.ts.net:8450. Open a design (gentle_design open or /gentle:design) to get its tailnet URL.' });
  assert.equal(log.length, 1);
});

test('stops the proxy when funnel is enabled after start', async () => {
  const log = [];
  const lost = [];
  let ts = okTs;
  const c = createController({ proxyPort: 34316, recheckMs: 10, readTailscale: async () => ts, createProxy: fakeProxyFactory(log), onExposureLost: (m) => lost.push(m) });
  await c.start();
  ts = { ...okTs, serve: { ...okTs.serve, AllowFunnel: { 'box.tailnet.ts.net:8450': true } } };
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(log.map((e) => e[0]), ['start', 'stop']);
  assert.equal(lost.length, 1);
  assert.match(lost[0].text, /tailscale funnel/);
  assert.equal(lost[0].level, 'error');
  assert.deepEqual(c.status(), { level: 'info', text: 'Canvas proxy is not running. Start it with /canvas:tailscale.' });
});

test('a recheck that started before stop/start never stops the new proxy', async () => {
  const log = [];
  let release;
  let calls = 0;
  const funnel = { ...okTs, serve: { ...okTs.serve, AllowFunnel: { 'box.tailnet.ts.net:8450': true } } };
  const readTailscale = async () => {
    calls += 1;
    if (calls === 2) return new Promise((r) => { release = () => r(funnel); }); // the first recheck hangs
    return okTs;
  };
  const lost = [];
  const c = createController({ proxyPort: 34316, recheckMs: 5, readTailscale, createProxy: fakeProxyFactory(log), onExposureLost: (m) => lost.push(m) });
  await c.start();
  await new Promise((r) => setTimeout(r, 20)); // recheck #1 is now waiting
  await c.stop();
  await c.start();
  release();
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(log.map((e) => e[0]).slice(0, 3), ['start', 'stop', 'start']);
  assert.deepEqual(lost, []);
  assert.notEqual(c.status().text, 'Canvas proxy is not running. Start it with /canvas:tailscale.');
  await c.stop();
});
