// Session-scoped state for the extension: starts the proxy only when Tailscale
// serves it on the tailnet (never under funnel), remembers the last canvas URL
// and turns it into its tailnet URL. Returns messages; the extension shows them.
// While running it re-reads Tailscale every recheckMs and stops the proxy as
// soon as the exposure is lost (funnel enabled, serve mapping removed).
import { createCanvasProxy } from './proxy.js';
import { publicUrlFor, readTailscale as readTailscaleDefault, resolveExposure } from './tailscale.js';

const OPEN_HINT = 'Open a design (gentle_design open or /gentle:design) to get its tailnet URL.';

/**
 * @typedef {{ level: 'info' | 'warning' | 'error', text: string }} Message
 * @param {{ proxyPort?: number, publicPort?: number, readTailscale?: () => Promise<{ status?: any, serve?: any }>, createProxy?: typeof createCanvasProxy, recheckMs?: number, onExposureLost?: (message: Message) => void }} [options]
 */
export function createController({ proxyPort = 34316, publicPort = 8450, readTailscale = readTailscaleDefault, createProxy = createCanvasProxy, recheckMs = 15000, onExposureLost = () => {} } = {}) {
  let proxy;
  let timer;

  async function shutdown() {
    clearInterval(timer);
    timer = undefined;
    const current = proxy;
    proxy = undefined;
    if (current) await current.stop();
    return current !== undefined;
  }

  async function recheck() {
    if (!proxy) return;
    const exposure = resolveExposure({ ...(await readTailscale()), proxyPort, publicPort });
    if (exposure.ok && exposure.publicOrigin === publicOrigin) return;
    if (!(await shutdown())) return;
    const text = exposure.ok ? `Tailscale now serves the proxy on ${exposure.publicOrigin}; run /canvas:tailscale again.` : exposure.message;
    onExposureLost({ level: exposure.ok || exposure.reason !== 'funnel' ? 'warning' : 'error', text: `Canvas proxy stopped. ${text}` });
  }
  let publicOrigin;
  let canvasUrl;

  const urlMessage = () => {
    const url = canvasUrl && publicUrlFor(canvasUrl, publicOrigin);
    return url ? { level: 'info', text: `Canvas on your tailnet: ${url}` } : undefined;
  };

  return {
    async start() {
      if (proxy) return urlMessage() ?? { level: 'info', text: `Proxy ready on ${publicOrigin}. ${OPEN_HINT}` };
      const exposure = resolveExposure({ ...(await readTailscale()), proxyPort, publicPort });
      if (!exposure.ok) return { level: exposure.reason === 'funnel' ? 'error' : 'warning', text: exposure.message };
      const next = createProxy({ listenPort: proxyPort, publicOrigin: exposure.publicOrigin });
      await next.start();
      proxy = next;
      publicOrigin = exposure.publicOrigin;
      timer = setInterval(() => { recheck().catch(() => {}); }, recheckMs);
      timer.unref?.();
      return urlMessage() ?? { level: 'info', text: `Proxy ready on ${publicOrigin}. ${OPEN_HINT}` };
    },
    async stop() {
      return (await shutdown()) ? { level: 'info', text: 'Canvas proxy stopped.' } : { level: 'info', text: 'Canvas proxy is not running.' };
    },
    status() {
      if (!proxy) return { level: 'info', text: 'Canvas proxy is not running. Start it with /canvas:tailscale.' };
      return urlMessage() ?? { level: 'info', text: `Proxy running on 127.0.0.1:${proxyPort} behind ${publicOrigin}. ${OPEN_HINT}` };
    },
    /** Records a canvas URL; returns its tailnet URL when the proxy is running. */
    recordCanvasUrl(url) {
      canvasUrl = url;
      return proxy ? publicUrlFor(url, publicOrigin) : undefined;
    },
  };
}
