# User guide

New to the app? Start with the [Beginner tutorials](/tutorials/) for step-by-step projects, screenshots, and editable checkpoints.

This guide walks through the workspace as it exists in v0.5.6. PiVo Craft is a working release with advanced subsets — **not a complete feature set**.

## Workspace layout

- **Document tabs** — New/Open adds tabs. Click a tab to switch; `×` closes it with a dirty-confirmation prompt. Every tab keeps its own history, selection, view, colors and dirty state, with document-scoped recovery slots.
- **Panels** — drag panel headings (or use their arrow controls) to dock and reorder; docks are resizable and settings persist. Left/right panels, bottom/side timeline layouts are supported.
- **Layers** — layers/groups with visibility, locks, opacity/blend controls, editable names and ordering.
- **Keyboard bindings** — editable, validated bindings with conflict/reservation detection. `Mod` means Ctrl/Cmd. Import/export as `.pxkeys`, or reset to defaults.

## Drawing

- Tools: pencil, eraser, line, rectangles/ellipses, fill, linear gradient, rectangular selection, magic wand, cel/selection translation and eyedropper.
- Brush size/opacity and several inks; basic 1px corner cleanup (pixel-perfect baseline mode); horizontal mirror and wrap-drawing options.
- **Pattern modes** — cursor stamps, captured-source/canvas tiling and destination/stroke-origin tiling. The native-pixel lattice is independent of footprint scale/rotation; phase metadata is portable.
- **Custom brushes** — capture RGBA brushes from selections, stamp colored/masked, set anchors and rotation, store 10 local preset slots, import/export as `.pxbrush`.
- **Dynamics** — pressure/velocity-driven size, opacity and angle, with timestamp sampling, arc-length spacing and distance-lag stabilization. Mouse pressure is constant; pen verification used simulated input, not calibrated hardware.

## Color, palettes and modes

- Original dark workspace plus a light theme (Sun/Moon button near Help). The explicit choice persists locally; without one, the editor follows OS color preference. Themes change chrome and viewport checker/grid/selection colors only — never artwork pixels, palettes, exports or history.
- Palette/color controls, layers, groups, visibility/locks, opacity and blend modes.
- **Mode conversion** — RGBA, indexed and grayscale conversion with frame-dependent palette edits. Indexed color adjustments require an explicit mode conversion.
- **Gradient ramps** — independent pressure/velocity/stroke-length ramps: FG→BG or palette, continuous or discrete stops, indexed quantization.
- **Pixel-vote resampling** — palette-preserving transform resampling alongside nearest-neighbor; a weighted inverse neighborhood with a documented foreground-retention bias (a deliberate style/quality tradeoff, not a universal improvement).

## Selection & transforms

- Selection transforms and clipboard are raster implementations. Integer flips and 90° rotation, canvas resize with nearest-neighbor scaling, inversion and an internal raster clipboard are available.
- **Numeric transform** — arbitrary rotation, scale, pivot and translation with inverse nearest-neighbor sampling, selection/copy behavior and single-step undo.

## Animation

- Frames with durations, copy/empty frames, **Continuous/linked cels**, unlink, timeline with tags and playback, onion skin, preview.
- Pressure/velocity/stroke-length dynamics feed animation strokes via `paintDynamic` (see [Headless API](/api)).

## Adjustments & text

- Preview/cancel/apply for brightness–contrast, HSL adjustments, gamma, piecewise RGB/channel curves, invert, grayscale and RGBA replacement — scoped to the active image, layer or all frames, with linked-image deduplication.
- **Raster text** — multiline content, local fonts, bold/italic, outline, and binary or antialiased glyph masks. Output depends on the browser/OS; hinting and desktop glyph-equivalence are not promised.

## Tilemap

- A starter embedded 8×8 tilemap layer with tile placement and Manual/Auto/Stack pixel modes.

## Theming details

- Slim, theme-aware scrollbars across panels, tool rail, timeline tracks, tabs, dialogs and toolbars.
- Outfit Variable typography with a role-specific scale (19px/700 branding, 11px/650 panel headings, 12px main controls, 11px captions with tabular numbers, 21px/650 dialog titles). Fonts and icons (Lucide) are bundled locally — no CDN.

See [Workspace internals](/workspace-guide) for state ownership, limits, recovery behavior and deferred floating/split/history features.
