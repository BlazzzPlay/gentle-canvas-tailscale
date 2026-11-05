import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createController } from "../src/controller.js";

// /canvas:tailscale [start|stop|status]: serve the gentle-design canvas to your
// tailnet through a loopback proxy behind `tailscale serve` (never funnel).
// Ports: GENTLE_CANVAS_TAILSCALE_PROXY_PORT (34316) and
// GENTLE_CANVAS_TAILSCALE_PUBLIC_PORT (8450, used in the setup hint).
const DESIGN_TOOL = "gentle_design";

function port(name: string, fallback: number): number {
	const value = Number(process.env[name]);
	return Number.isInteger(value) && value > 0 && value < 65536 ? value : fallback;
}

export default function canvasTailscale(pi: ExtensionAPI): void {
	// Last UI seen, so a background exposure check can tell the user it stopped.
	let notify: ((text: string, level: "info" | "warning" | "error") => void) | undefined;
	const controller = createController({
		onExposureLost: (message) => notify?.(message.text, message.level),
		proxyPort: port("GENTLE_CANVAS_TAILSCALE_PROXY_PORT", 34316),
		publicPort: port("GENTLE_CANVAS_TAILSCALE_PUBLIC_PORT", 8450),
	});

	pi.registerCommand("canvas:tailscale", {
		description: "Serve the design canvas on your tailnet: /canvas:tailscale [start|stop|status]",
		handler: async (args, ctx) => {
			notify = (text, level) => ctx.ui.notify(text, level);
			const action = String(args ?? "").trim() || "start";
			let message;
			if (action === "start") {
				try {
					message = await controller.start();
				} catch (error) {
					message = { level: "error", text: `Could not start the canvas proxy: ${(error as Error).message}` };
				}
			} else if (action === "stop") message = await controller.stop();
			else if (action === "status") message = controller.status();
			else message = { level: "warning", text: "Usage: /canvas:tailscale [start|stop|status]" };
			ctx.ui.notify(message.text, message.level as "info" | "warning" | "error");
		},
	});

	// The canvas never writes its URL anywhere; gentle_design open/list return it.
	pi.on("tool_execution_end", (event, ctx) => {
		if (event.toolName !== DESIGN_TOOL || event.isError) return;
		const details = (event.result as { details?: { url?: unknown; canvas?: { url?: unknown } } } | undefined)?.details;
		const url = typeof details?.url === "string" ? details.url : typeof details?.canvas?.url === "string" ? details.canvas.url : undefined;
		if (!url) return;
		const publicUrl = controller.recordCanvasUrl(url);
		if (publicUrl) ctx.ui.notify(`Canvas on your tailnet: ${publicUrl}`, "info");
	});

	pi.on("session_shutdown", async () => {
		await controller.stop();
	});
}
