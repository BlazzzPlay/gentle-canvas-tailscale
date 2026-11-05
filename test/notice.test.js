import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCanvasNotice, watchNotify } from '../src/notice.js';

const URL1 = 'http://127.0.0.1:37643/tok_tok_tok_tok_tok/d/site/';

test('parses the /gentle:design open and refresh notices', () => {
  assert.equal(parseCanvasNotice(`Design canvas: ${URL1}`), URL1);
  assert.equal(parseCanvasNotice(`Design canvas refreshed: ${URL1}\nCould not open a browser.`), URL1);
});

test('ignores other notices and non-loopback URLs', () => {
  assert.equal(parseCanvasNotice('Design canvas stopped.'), undefined);
  assert.equal(parseCanvasNotice('Design canvas: https://evil.example/tok/d/x/'), undefined);
  assert.equal(parseCanvasNotice(undefined), undefined);
});

test('watchNotify forwards every notice unchanged and reports canvas URLs once wrapped', () => {
  const shown = [];
  const ui = { notify: (t, l) => shown.push([t, l]) };
  const seen = [];
  watchNotify(ui, (url) => seen.push(url));
  watchNotify(ui, (url) => seen.push(url)); // idempotent: no double wrap
  ui.notify(`Design canvas: ${URL1}`, 'info');
  ui.notify('hello', 'warning');
  assert.deepEqual(shown, [[`Design canvas: ${URL1}`, 'info'], ['hello', 'warning']]);
  assert.deepEqual(seen, [URL1]);
});

test('watchNotify never breaks notify when the listener throws', () => {
  const shown = [];
  const ui = { notify: (t) => shown.push(t) };
  watchNotify(ui, () => { throw new Error('boom'); });
  ui.notify(`Design canvas: ${URL1}`);
  assert.deepEqual(shown, [`Design canvas: ${URL1}`]);
});
