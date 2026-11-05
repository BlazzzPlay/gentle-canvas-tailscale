import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createController } from "../src/controller.js";
import { watchNotify } from "../src/notice.js";

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

	// A canvas URL appeared (gentle_design tool or the /gentle:design notice):
	// start the proxy if needed and show the local and tailnet addresses at once.
	const announce = (url: string, ui: { notify: (text: string, level: "info" | "warning" | "error") => void }) => {
		void controller.openCanvas(url).then((message) => {
			const text = message.text.startsWith("Canvas local:") ? message.text : `Canvas local: ${url}\n${message.text}`;
			ui.notify(text, message.level as "info" | "warning" | "error");
		});
	};
	const watch = (ctx: { ui: { notify: (text: string, level: "info" | "warning" | "error") => void } }) => {
		notify = (text, level) => ctx.ui.notify(text, level);
		watchNotify(ctx.ui, (url: string) => announce(url, ctx.ui));
	};
	pi.on("session_start", (_event, ctx) => watch(ctx));
	pi.on("input", (_event, ctx) => watch(ctx));

	pi.registerCommand("canvas:tailscale", {
		description: "Serve the design canvas on your tailnet: /canvas:tailscale [start|stop|status]",
		handler: async (args, ctx) => {
			watch(ctx);
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
	// Append the tailnet address to the tool result itself, so the model sees it
	// and can hand it to the user (a ui.notify alone never reaches the model).
	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName !== DESIGN_TOOL || event.isError) return;
		const details = event.details as { url?: unknown; canvas?: { url?: unknown } } | undefined;
		const url = typeof details?.url === "string" ? details.url : typeof details?.canvas?.url === "string" ? details.canvas.url : undefined;
		if (!url) return;
		watch(ctx);
		const message = await controller.openCanvas(url);
		const text = message.text.startsWith("Canvas local:") ? message.text : `Canvas local: ${url}\n${message.text}`;
		if (message.level !== "info") ctx.ui.notify(text, message.level as "warning" | "error");
		return { content: [...event.content, { type: "text", text }], structuredContent: event.structuredContent };
	});

	pi.on("session_shutdown", async () => {
		await controller.stop();
	});
}
