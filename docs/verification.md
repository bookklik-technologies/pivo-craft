# Verification

What is actually tested for this release, and what is not. Raw evidence lives in `docs/verification.json`, `docs/unit-results.json` and `scripts/browser/results/*.json`.

## Test layers

| Layer | Command | Scope |
| --- | --- | --- |
| Unit/integration | `npm test` | Headless core/codec tests under `packages/*/test` |
| Coverage | `npm run test:coverage` | Branch coverage — currently **below** the 90% branch target |
| Browser smoke | `node scripts/browser/browser-smoke.mjs` (dev server on port 5173) | Core editing flows in headless Chromium |
| Browser suites | `browser-m4`, `browser-refinements`, `browser-codecs`, `browser-workspace` (+ density/font/icons/scrollbars/theme/typography scripts) | Advanced controls, pen simulation, codecs, workspace behaviors |

Each browser script writes its `*-results.json` evidence to `scripts/browser/results/`. The layout is checked at 1024/1280/1440/1920px widths plus side docking.

## External decoding checks

Exported PNG and GIF files were additionally decoded with **Pillow** (independent decoder) to confirm output correctness. GIF exports report timing, alpha and color conversions.

## Current caveats

- Browser checks were run in **headless Chromium 141** — Safari/Firefox are not verified.
- Unit tests do not establish complete desktop interoperability (see the [compatibility matrix](/compatibility-matrix)).
- Performance targets are **not certified**.
- Rotation, blend and profile algorithms are documented contracts; their output is verified by the automated regression suite (see [algorithm contracts](/algorithm-contracts)).
