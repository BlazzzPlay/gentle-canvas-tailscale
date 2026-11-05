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

// True when a serve target (any scheme, case, path, or bare host:port / port)
// reaches `port` on this machine: localhost, 127.0.0.0/8, 0.0.0.0 or ::1/::.
function targetsPort(target, port) {
  const s = String(target).trim();
  if (/^\d+$/.test(s)) return Number(s) === port;
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `tcp://${s}`);
  } catch {
    return false;
  }
  if (Number(url.port) !== port) return false;
  const h = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  // IPv4-mapped IPv6 (::ffff:127.x, ::ffff:0.0.0.0) also reaches the IPv4
  // listener; Node's URL parser writes them as ::ffff:7fxx:xxxx and ::ffff:0:0.
  const mapped = h.match(/^::ffff:(.+)$/)?.[1];
  if (mapped && (/^127\./.test(mapped) || mapped === '0.0.0.0' || /^7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(mapped) || mapped === '0:0')) return true;
  return h === 'localhost' || h === '0.0.0.0' || h === '::1' || h === '::' || /^127\.\d+\.\d+\.\d+$/.test(h);
}

/**
 * @returns {{ ok: true, publicOrigin: string, host: string } | { ok: false, reason: 'no-tailscale' | 'no-serve' | 'funnel', message: string }}
 */
export function resolveExposure({ status, serve, proxyPort, publicPort = 8450 }) {
  const host = status?.Self?.DNSName?.replace(/\.$/, '');
  if (!host) return { ok: false, reason: 'no-tailscale', message: 'Tailscale is not running or not logged in (`tailscale status` failed).' };
  // Every serve entry that reaches the proxy, on any path or as a raw TCP
  // forward. Funnel on any of them exposes the canvas, so all are checked first.
  // Foreground sessions (`tailscale funnel <port>` without --bg) live under
  // Foreground.<session> with their own Web/TCP/AllowFunnel.
  const reaching = [];
  const funnel = { ...(serve?.AllowFunnel ?? {}) };
  let rootMapping;
  const configs = [{ config: serve, background: true }, ...Object.values(serve?.Foreground ?? {}).map((config) => ({ config, background: false }))];
  for (const { config, background } of configs) {
    Object.assign(funnel, config?.AllowFunnel ?? {});
    for (const [hostPort, web] of Object.entries(config?.Web ?? {})) {
      for (const [path, handler] of Object.entries(web?.Handlers ?? {})) {
        if (!handler?.Proxy || !targetsPort(handler.Proxy, proxyPort)) continue;
        reaching.push(hostPort);
        if (background && path === '/' && !rootMapping) rootMapping = hostPort;
      }
    }
    for (const [port, tcp] of Object.entries(config?.TCP ?? {})) {
      if (tcp?.TCPForward && targetsPort(tcp.TCPForward, proxyPort)) reaching.push(`${host}:${port}`);
    }
  }
  const funneled = reaching.find((hostPort) => funnel[hostPort]);
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
