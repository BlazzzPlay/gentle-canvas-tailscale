# gentle-canvas-tailscale
Pi / Gentle Shell extension that opens the gentle-design canvas from other devices on your tailnet, through a loopback reverse proxy behind `tailscale serve`.
Interim solution until Gentle Shell supports remote canvas access itself.

## Specs
- S1 "mover el proxy al repo con detección automática del puerto": the proxy finds the canvas port by itself (token-path probe), never hardcoded; never picks a catch-all SPA or another proxy copy.
- S2 "opcion a" = "te armo la extensión en un repo nuevo ... y te la dejo lista para publicar": a Pi extension that starts/stops the proxy with the session; no machine-specific values (tailnet host from `tailscale status --json`, ports configurable); a command that shows the public URL (captured from `gentle_design` results); README warning it is tailnet-only and the extension refuses to run when `tailscale funnel` exposes it; tests.
- S3 "y publicala con la etiqueta correspondeitne y hay que crear icono etc": public GitHub repo with Gentle Hub topics `gentle-shell-package` and `gentle-shell-extension`; an icon (and social preview image).
- S4 Name "gentle-canvas-tailscale", license "MIT", location "/home/blazz/projects/<nombre>".

## Tasks
- T1 S4 inline: scaffold repo, feature doc — commit: ce4a6e3 [x]
- T2 S1,S2 inline: proxy lib + tailscale detection + funnel guard + tests — commit: ce4a6e3, fixes 705e8cf 8773629 e21f36a [x]
- T3 S2 inline: extension (/canvas:tailscale), URL capture, session_shutdown — commit: 6827196 [x]
- T4 S2,S3 inline: README, icon, social preview — commit: 35cbb54 [x]
- T5 S1-S3 verify: tests, pi load, live tailnet, gentle-ai-verify — commit: n/a [x]
- T6 S3 inline: create public GitHub repo, push, topics — commit: n/a (v0.1.0), v0.1.1 [x]

## Log
- L1 (user): "Retomá el canvas por Tailscale ... Siguiente paso: <dejarlo así / mover el proxy al repo con detección automática del puerto>" then "adelante".
- L2 (user, after reviewing Gentle Hub): "la imprepemtacion por el dueño del proyecto esta pendiente pero podriamos publicar mientras esta solucion https://gentlemanprogramming.com/gentle-hub/?type=extension revsai esta web y sus apartados"
- L3 (user): "opcion a"; answers: gentle-canvas-tailscale, MIT, /home/blazz/projects/<nombre>.
- L4 (user): "y publicala con la etiqueta correspondeitne y hay que crear icono etc"
- L5 evidence: Gentle Hub lists public repos by topic (gentle-shell-package + optional gentle-shell-extension); entries carry no icon field. pi installs git sources: `pi install git:github.com/<owner>/<repo>`. Origin proxy: web-porfolio scripts/canvas-tailscale-proxy.mjs (verifier D1 fixed with x-canvas-proxy mark).
- L6 evidence: gentle-ai-verify round 1 FAIL (D1 funnel guard bypass: first-match only, non-root paths, TCP forwards) -> fixed 705e8cf (+ periodic recheck, D2). Round 2 FAIL (D1a Foreground sessions, D1b target spellings) -> fixed 8773629 (+ recheck race). Round 3 PASS (S1 met, S2 met, S4 met); advisory IPv4-mapped IPv6 fixed e21f36a. 37 tests green; tsc clean against pi 1.4.0 types; harness load + live tailnet e2e OK; not loaded in a real pi runtime yet.
- L8 (user): "mejoremos lo pendinten". Evidence: 44 tests green; tsc --strict clean against pi types; loaded in a real pi runtime (`pi -ne -e extensions/canvas-tailscale.ts -p /canvas:tailscale` exit 0, bad path exit 1). Released v0.1.1 (1b75aed, cf8dc59, 2d206f9). Pending (user): social preview upload in GitHub Settings.
