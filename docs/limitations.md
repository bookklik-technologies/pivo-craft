# Limitations & known gaps

PiVo Craft is a working initial release with advanced subsets — **not a complete feature set**. The following limitations are deliberate and documented.

## Workspace & history

- Arbitrary floating/split/multiview workspace is not implemented.
- No robust branching history UI; core history uses **snapshots** rather than region patches, and retains one undo entry even if it exceeds the configured budget.
- Pixel-perfect cleanup is the constant 1px baseline mode, not the custom/dynamic stamping algorithm.

## Formats & color

- PNG imports standard grayscale/indexed/RGB/alpha depths and Adam7, expanding to RGBA; 16-bit precision and ignored profile metadata are diagnosed; APNG is rejected.
- ASE support is a declared subset: byte-preserving unknown-chunk roundtrip is not promised, strict ASE rewriting blocks unmodeled source metadata, and passthrough groups must be isolated explicitly before strict export. External references are not auto-fetched. Embedded tilemap interchange is not fully certified.
- Indexed color adjustments require an explicit mode conversion; partial alpha is quantized when a raster overlay targets indexed artwork. Curves are piecewise-linear, not spline-matched.
- Selection transforms/clipboard are raster implementations; background/cropped/offset/mixed-mode edge cases need expanded tests.

## Platform & runtime

- All codecs are **synchronous**. Limits reduce allocation risk, but this is not a formally audited hostile-file processor — do not enable automatic imports of untrusted batches. Keep a `.pvc` download of valuable work.
- No worker offloading; high-quality smooth rotation is not implemented.
- No advanced color management (this is not ICC color management).
- No extensions, Lua scripting or CLI.
- No atlas extrusion/inner-padding controls.
- Brush/dynamics presets are stored separately from `.pvc` artwork; export presets for portability.
- Raster text font output depends on the browser/OS; hinting and desktop glyph-equivalence are not promised.
- Broad accessibility/performance certification remains unfinished.
