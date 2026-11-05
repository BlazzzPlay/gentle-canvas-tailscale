// Reads (never changes) the Tailscale configuration: which tailnet origin
// `tailscale serve` maps to the proxy, and whether `tailscale funnel` would
// expose it to the internet, in which case the extension refuses to run.
import { execFile } from 'node:child_process';

function readJson(args) {
  return new Promise((resolve) => {
    execFile('tailscale', args, { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(undefined);
      try { resolve(JSON.parse(stdout)); } catch { resolve(undefined); }
    });
  });
}

export async function readTailscale() {
  const [status, serve] = await Promise.all([readJson(['status', '--json']), readJson(['serve', 'status', '--json'])]);
  return { status, serve };
}

function targetsPort(proxy, port) {
  const s = String(proxy).trim().replace(/\/+$/, '');
  return s === String(port) || s === `http://127.0.0.1:${port}` || s === `http://localhost:${port}` || s === `127.0.0.1:${port}` || s === `localhost:${port}`;
}

/**
 * @returns {{ ok: true, publicOrigin: string, host: string } | { ok: false, reason: 'no-tailscale' | 'no-serve' | 'funnel', message: string }}
 */
export function resolveExposure({ status, serve, proxyPort, publicPort = 8450 }) {
  const host = status?.Self?.DNSName?.replace(/\.$/, '');
  if (!host) return { ok: false, reason: 'no-tailscale', message: 'Tailscale is not running or not logged in (`tailscale status` failed).' };
  // Every serve entry that reaches the proxy, on any path or as a raw TCP
  // forward. Funnel on any of them exposes the canvas, so all are checked first.
  const reaching = [];
  let rootMapping;
  for (const [hostPort, web] of Object.entries(serve?.Web ?? {})) {
    for (const [path, handler] of Object.entries(web?.Handlers ?? {})) {
      if (!handler?.Proxy || !targetsPort(handler.Proxy, proxyPort)) continue;
      reaching.push(hostPort);
      if (path === '/' && !rootMapping) rootMapping = hostPort;
    }
  }
  for (const [port, tcp] of Object.entries(serve?.TCP ?? {})) {
    if (tcp?.TCPForward && targetsPort(tcp.TCPForward, proxyPort)) reaching.push(`${host}:${port}`);
  }
  const funneled = reaching.find((hostPort) => serve?.AllowFunnel?.[hostPort]);
  if (funneled) {
    return { ok: false, reason: 'funnel', message: `${funneled} is exposed to the internet with tailscale funnel. This extension is tailnet-only: run \`tailscale funnel --https=${funneled.split(':')[1]} off\` and keep only \`tailscale serve\`.` };
  }
  if (rootMapping) {
    const [h, port] = rootMapping.split(':');
    return { ok: true, publicOrigin: port === '443' ? `https://${h}` : `https://${h}:${port}`, host: h };
  }
  return { ok: false, reason: 'no-serve', message: `No tailscale serve mapping points to the proxy. Run once: tailscale serve --bg --https=${publicPort} http://127.0.0.1:${proxyPort}` };
}

/** Swaps the loopback origin of a canvas URL for the public tailnet origin. */
export function publicUrlFor(canvasUrl, publicOrigin) {
  try {
    const u = new URL(canvasUrl);
    return `${publicOrigin}${u.pathname}${u.search}`;
  } catch {
    return undefined;
  }
}
