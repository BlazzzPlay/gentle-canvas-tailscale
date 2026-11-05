// /gentle:design shows its canvas URL only through ui.notify ("Design canvas: <url>"
// or "Design canvas refreshed: <url>"), with no event other extensions can read.
// Pi hands every extension the same ui object, so wrapping its notify once lets
// this extension see that URL without the gentle_design tool call.
const NOTICE = /^Design canvas(?: refreshed)?: (http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+\/\S*)/m;
const WATCHED = Symbol.for('gentle-canvas-tailscale.notify');

/** Returns the loopback canvas URL in a gentle-design notice, if any. */
export function parseCanvasNotice(text) {
  return typeof text === 'string' ? text.match(NOTICE)?.[1] : undefined;
}

/** Wraps ui.notify once; the latest onUrl gets every canvas URL shown. Notices pass through unchanged. */
export function watchNotify(ui, onUrl) {
  if (!ui || typeof ui.notify !== 'function') return;
  if (ui.notify[WATCHED]) {
    ui.notify[WATCHED].onUrl = onUrl;
    return;
  }
  const original = ui.notify;
  const state = { onUrl };
  const wrapped = function (text, ...rest) {
    const result = original.call(this, text, ...rest);
    const url = parseCanvasNotice(text);
    if (url) {
      try { state.onUrl(url); } catch { /* never break notify */ }
    }
    return result;
  };
  wrapped[WATCHED] = state;
  ui.notify = wrapped;
}
