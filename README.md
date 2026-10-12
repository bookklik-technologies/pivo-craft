# PiVo Craft — v0.5.6 Outfit hierarchy release

An original, local-first browser pixel-art and animation editor. This is a working initial release with advanced subsets, **not a complete feature set**.

## Run

Requires Node.js 20.19+ or 22.12+ (tested with Node 24.14.1).

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. All editing stays in your browser; no account or project upload required.

```sh
npm run build        # typecheck + production app in dist/
npm test             # headless core/codec tests
npm run test:coverage
npx playwright install chromium
node scripts/browser/browser-smoke.mjs  # start dev server on port 5173 first
node scripts/browser/browser-m4.mjs     # advanced controls, simulated pen input and persistence
node scripts/browser/browser-refinements.mjs # pattern phase, gradient colors and pixel-vote undo
node scripts/browser/browser-codecs.mjs     # indexed/Adam7 PNG, GIF loops and legacy tilemap imports
node scripts/browser/browser-workspace.mjs  # tabs, recovery slots, docks and shortcut remapping
```

Each script writes its `*-results.json` evidence to `scripts/browser/results/` (the remaining scripts cover density, font, icons, scrollbars, theme and typography).

A standalone offline-capable HTML file is provided in release packages as `dist/standalone.html`. The separate `package-release.py` release-packaging script generates it from a production build and existing verification artifacts; `npm run build` does not generate it. File downloads work without a backend. Browser file origins or embedded previews may restrict IndexedDB; use normal hosted/localhost operation for reliable recovery. Download or open the supplied standalone file in a desktop browser for full-size use. No remote deployment has been performed.

## Documentation

After `npm ci`, run these commands from the app's repository root:

```sh
npm run docs:dev      # start the VitePress documentation server
npm run docs:build    # generate the static documentation site
npm run docs:preview  # preview the built documentation site
npm run docs:capture  # recreate tutorial screenshots and downloadable checkpoints
```

Open the local URL printed by VitePress. The documentation build is written to `docs/.vitepress/dist`; run `docs:build` before `docs:preview`. The application build remains in `dist/`.

The [beginner tutorials](docs/tutorials/index.md) cover one project through three lessons, with real screenshots and editable native-project checkpoints. `docs:capture` starts a temporary local Vite server, uses a fresh Chromium session, writes assets to `docs/public/tutorials/`, and closes the browser/server afterward. It uses an installed Playwright Chromium browser (or installed Chrome); if neither is present, install Chromium with `npx playwright install chromium` first.

## Implemented UI

- Pencil, eraser, line, rectangles/ellipses, fill, linear gradient, rectangular selection, magic wand, cel/selection translation, eyedropper.
- Brush size/opacity, several inks, basic 1px corner cleanup, horizontal mirror and wrap-drawing options.
- Multiple document tabs with independent history/selection/view/colors/dirty state, explicit unsaved-close protection and document-scoped recovery.
- Dockable/reorderable left/right panels, resizable docks, bottom/side timeline layouts and persistent settings.
- Validated configurable keyboard bindings with conflicts/reservations, .pxkeys import/export and reset.
- Original dark workspace, palette/color controls, layers/groups, visibility/locks, opacity/blend controls, editable layer names and ordering.
- RGBA, indexed and grayscale conversion; frame-dependent palette edits.
- Integer flips/90° rotation, canvas resize/nearest-neighbor scaling, inversion, internal raster clipboard.
- Frames, durations, copy/empty frame, Continuous/linked cels, unlink, timeline, tags and playback, onion skin, preview.
- Native ZIP .pvc save/open, bounded local recovery checkpoints, PNG import, PNG/frame sequence/sheet+JSON export, GIF export and ASE supported-subset import/export.
- Pattern modes: cursor stamps, captured-source/canvas tiling and destination/stroke-origin tiling. Native-pixel lattice is independent of footprint scale/rotation; phase metadata is portable.
- Independent pressure/velocity/stroke-length gradient ramps: FG→BG or palette, continuous or discrete stops, indexed quantization.
- Palette-preserving pixel-vote transform resampling alongside nearest; weighted inverse neighborhood with a documented foreground-retention bias — a deliberate style/quality tradeoff, not a universal improvement.
- Custom RGBA brush capture from selections, colored/mask stamping, anchors, rotation, 10 local preset slots and portable .pxbrush import/export.
- Pressure/velocity-driven size, opacity and angle; timestamp sampling, arc-length spacing and distance-lag stabilization. Mouse pressure is constant; pen verification used simulated input, not calibrated hardware.
- Raster text with multiline content, local fonts, bold/italic, outline and binary or antialiased glyph masks.
- Preview/cancel/apply brightness-contrast, HSL adjustments, gamma, piecewise RGB/channel curves, invert, grayscale and RGBA replacement; active/layer/all-frame scopes with linked-image deduplication.
- Numeric arbitrary rotation, scale, pivot and translation with inverse nearest-neighbor sampling, selection/copy behavior and single-step undo.
- Starter embedded 8×8 tilemap layer with tile placement and pixel Manual/Auto/Stack modes.

API modules under packages/core and packages/codecs are usable headlessly. The UI consumes the same compositor as atlas/GIF export.

## Verification

See docs/verification.json, scripts/browser/results/*.json and docs/feature-status.md for the actual run evidence. Unit tests do not establish complete desktop interoperability. Browser smoke checks were run in headless Chromium 141, not Safari/Firefox. Exported PNG and GIF were additionally decoded with Pillow. Coverage is below a 90% branch target. Performance targets are not certified.

## Important limitations

- Rotation, blend and profile algorithms are documented contracts; their output is verified by the automated regression suite.
- PNG imports standard grayscale/indexed/RGB/alpha depths and Adam7, expanding to RGBA. 16-bit precision and ignored profile metadata are diagnosed; APNG is rejected. GIF imports composited animation/disposal/interlace/loops; export reports timing, alpha and color conversions. See docs/compatibility-matrix.md.
- ASE has a declared supported subset. Unknown chunks and unsupported data are diagnosed; byte-preserving unknown-chunk roundtrip is not promised, and strict ASE rewriting blocks unmodeled source metadata. Passthrough groups must be made isolated explicitly before strict ASE export. External references are not auto-fetched. Embedded tilemap interchange is not fully certified.
- Arbitrary floating/split/multiview workspace and robust branching history UI, high-quality smooth rotation, advanced color management, extensions/Lua/CLI, worker offloading, atlas extrusion/inner-padding controls, and broad accessibility/performance certification remain unfinished.
- Pattern modes and gradient dynamics are implemented; their exact lattice/sensor/color rules are documented in docs/algorithm-contracts.md. Pixel-perfect cleanup is the constant 1px baseline mode, not the custom/dynamic stamping algorithm. Brush/dynamics presets are stored separately from .pvc artwork; export presets for portability. Font output depends on this browser/OS; hinting and desktop glyph-equivalence are not promised.
- Indexed color adjustments require an explicit mode conversion; partial alpha is quantized when a raster overlay targets indexed artwork. Curves are piecewise-linear rather than spline-matched.
- Selection transforms/clipboard are raster implementations; background/cropped/offset/mixed-mode edge cases need expanded tests. Core history uses snapshots rather than region patches and retains one undo entry even if it exceeds the configured budget.
- All codecs are synchronous. Limits reduce allocation risk but this is not a formally audited hostile-file processor. Do not enable automatic imports of untrusted batches. Keep a .pvc download of valuable work.

## Layout

- apps/editor/src: original native DOM/Canvas application.
- packages/core/src: document model, raster, selections, commands, compositor, playback and history.
- packages/codecs/src: original format adapters plus reviewed fflate/gifenc dependencies.
- packages/*/test: unit/integration fixtures.
- docs: status, contracts and verification.
- dist: built app and standalone browser build.

## Licenses

Runtime dependencies: fflate (MIT), gifenc (MIT), locally bundled Lucide 1.54.0 (ISC plus Feather MIT notices), and self-hosted Outfit Variable via Fontsource 5.3.0 (SIL OFL 1.1). Their actual license texts are included in docs/third-party. The project source is released under the MIT License (see LICENSE). Tooling has its own dependency licenses.

## v0.4 compatibility changes

Added strict PNG structure/CRC/depth/Adam7 parsing; bounded GIF LZW/disposal import and loss-aware export; fixed ASE shared content, frame palette ordering/base snapshots, future slices, budgets, link cycles and metadata guards; normalized legacy tile empties, separated baseIndex from indexing, corrected nested group opacity and cel z-order, and verified native ZIP member CRC. PNG/GIF/legacy ASE fixtures are included. Complete interoperability and security certification are not claimed.

## Workspace usage

New/Open adds tabs. Click a tab to switch; × closes it with dirty confirmation. Layout moves the timeline and sets panel widths; drag panel headings or use their arrow controls to dock/reorder. Keys edits bindings; Mod means Ctrl/Cmd. See docs/workspace-guide.md for state ownership, limits, recovery behavior and deferred floating/split/history features.

## UI icons

Tools, actions, layer states, playback, tab close and dock controls use selected Lucide SVG imports, bundled locally without a CDN or icon font. Decorative SVGs are aria-hidden and focusable=false; existing control labels and shortcut hints remain. The Lucide license text is included in docs/third-party and the standalone build.

## Desktop refinement

Control heights and spacing are standardized: 32px header actions, 28–30px compact controls and 38px drawing tools. Panel button groups use aligned grids; color and layer rows have explicit layouts, and layer reorder controls stay paired. New layout defaults use wider docks (280px left / 292px right); saved widths are retained. Responsive panel containers and desktop header breakpoints prevent accidental label wrapping and horizontal clipping; horizontal timeline scrolling remains deliberate at constrained widths. Layout checks cover 1024/1280/1440/1920px and side docking, not full mobile/accessibility certification.

## Themes

Use the Sun/Moon button near Help to switch light/dark appearance. The explicit choice persists locally; without a saved choice, the editor follows OS color preference. Themes change chrome, native control color-scheme and viewport checker/grid/selection colors only. Artwork pixels, palettes, exports, histories and refined control sizes are not changed. Preference is workspace-wide, not saved into .pvc files. Storage-denied previews keep the choice for the current session. This patch is not ICC color management or a full contrast/accessibility certification.

## Scrollbars

Panels, tool rail, timeline tracks, document tabs, dialogs, shortcut lists and horizontal toolbars use slim theme-aware scrollbars. Chromium/WebKit styling has rounded thumbs, transparent tracks and hover/active colors; standard scrollbar-color/width is the Firefox fallback. Scrolling remains native, with forced-color system tokens rather than JS emulation. Chromium scrolling/layout checks passed; broader OS/browser accessibility certification is not implied.

## Typography

Outfit Variable is the main UI typeface, with local Latin/Latin-extended WOFF2 assets and system fallbacks for other scripts. UI controls inherit the font; Lucide remains SVG. Standalone HTML embeds both font files as data URLs and includes the original SIL OFL notice, so no font CDN/network is required. The raster text tool keeps its explicit chosen font; existing artwork/export pixels are not changed.

## UI type scale

Outfit typography uses role-specific sizes/weights: 19px/700 branding, 11px/650 panel headings with restrained tracking, 12px main controls, 11.5px/500 compact actions, 11px captions/status with tabular numbers, and 21px/650 dialog titles. Narrow docks/header widths have compact overrides. These are UI-only changes; artwork text fonts and data are unchanged. Desktop containment checks and existing workflows are retained; this is not a full readability/accessibility certification.
