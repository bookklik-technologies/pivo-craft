# Implementation status — v0.5

This is a working animation-capable initial release and advanced-feature subset. The full approved roadmap is not finished. Controls listed as implemented invoke real operations; missing functionality is not represented by decorative placeholder menus.

| Milestone | Status | Evidence / remaining work |
|---|---|---|
| M0 | Baseline implemented; partial full gate | Core modules and test generators exist. Dependency/license records included. Not all validation/property targets are certified. |
| M1 | Baseline implemented | DOM/Canvas viewport, original native project ZIP, save/open and local recovery. Chromium smoke save/reopen; fallback/quota/interruption matrix incomplete. |
| M2 | Baseline implemented; edge cases partial | Drawing, selection and integer transforms, layers and history have tests. Full clipboard/floating/background/cropped-image behavior needs expansion. |
| M3 | Baseline implemented | Four-frame example, frames/links/tags, playback, onion/preview, PNG/sheets/GIF workflows. Browser tested core draw/copy/link/save/export flow; full finite playback visual regression incomplete. |
| M4 | Advanced editing increment implemented; broad milestone still partial | Custom brushes/presets, pressure/velocity size-opacity-angle dynamics, stabilization/spacing, local-font raster text, seven adjustment kinds and arbitrary nearest-neighbor transforms with preview/undo. Core and Chromium tests pass. Source/destination patterns, independent gradient ramps and palette-vote resampling are implemented and tested. Full color management and exact desktop algorithm equivalence remain unfinished/unverified. |
| M5 | Hardened supported subset | PNG standard depths/types/Adam7/tRNS; GIF LZW/disposal/interlace/loops and explicit losses; ASE strict boundaries, sharing, palettes/slices and unsupported-metadata write guards. Independent fixtures and browser roundtrips; still no installed-desktop conformance corpus or unknown-chunk archival preservation. |
| M6 | Partial | Native embedded tilesets and tile mode operations, shared-reference tests and starter UI. Full tile transform/resize/export/import corpus is not certified. |
| M7 | Workspace increment implemented; broad milestone partial | Independent document tabs/history/views, document-scoped recovery, movable/reorderable/resizable docks and bottom/side timeline, persistent configurable shortcuts/import/export/reset. No arbitrary floating/split/multiview UI, production branching history or complete storage/offline certification. |
| M8 | Not implemented | No third-party code execution, Lua, Node CLI, extension host or complete batch UI. |
| M9 | Partial verification | Build/typecheck, automated tests, Chromium smoke, coverage and independent file decoding. No 90% branch coverage, Safari/Firefox suite, formal fuzz/security/accessibility review or performance certification. |

## Known engineering constraints

- Snapshot history has higher memory cost than transactional region patches; branch methods are experimental and not exposed by the UI.
- Imports and exports are synchronous; worker offloading is unfinished.
- UI uses original browser-oriented shortcuts; desktop keyboard parity is not claimed.
- ASE readability, editability, faithful rendering and safe rewriting are different claims. Inspect diagnostics and retain originals.
- Documented defaults/limits may differ from the current codec adapters; application validation additionally caps editable document dimensions.
- Broader benchmarks, adversarial inputs and browser input/accessibility testing remain necessary before production use.

## v0.4 verification fixes

Advanced browser tests found and fixed native form step mismatches that blocked Apply, and the shape gesture starter that prematurely cancelled line/rectangle/ellipse drawing. Exact-alpha tests corrected the CPU compositor to return straight RGB under partially transparent backdrops; exports use this same compositor. Hardware input is CDP simulated pen only, not a real-device certification. See docs/verification.json for current measured counts and coverage.

## v0.4 refinements

Canvas/stroke pattern phases and native tiling, independent gradient axes and palette/FG-BG ramps, and optional 3×3 palette-vote rotation are implemented. Corrected the Copy RGBA ink to copy source alpha rather than synthesize opaque alpha. Pixel-vote can thicken edges or suppress small contrasting features; no universal superiority is claimed.

## v0.4 interoperability

See compatibility-matrix.md for exact support, rejection and loss policies. Fixes include Copy Frame duration, PNG packed/depth/transparency rules, GIF once/finite loops and transparent palette reservation, ASE linked content identity, frame-zero palette state and correctly placed later palette chunks, legacy tile empties/base indices, nested group opacity/z-order and native ZIP CRC. Failed imports are checked before the active project is replaced.

## v0.5 workspace

See workspace-guide.md. New/Open no longer replaces the active project. Existing codec browser fixtures now explicitly close prior test documents to respect the 8-tab limit. Tab dirty consent, state/undo isolation, compatible clipboard paste, recovery slots, native panel dragging/resizing, timeline positions and editable/reloadable key maps are browser tested.
