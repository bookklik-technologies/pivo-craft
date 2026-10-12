# File formats

## Native project format — `.pvc`

PiVo Craft's own format is a **ZIP container** (`.pvc`) written by the native codec (`saveNative`/`loadNative`), with verified member CRCs. Save/open are available from the UI; [verification](/verification) documents the ZIP structural checks.

::: tip Keep downloads of valuable work
Recovery checkpoints in the browser are bounded and can be restricted in embedded/standalone contexts. A downloaded `.pvc` copy is the reliable persistence path.
:::

## Import

| Format | Support |
| --- | --- |
| PNG | Grayscale/indexed/RGB/alpha depths, Adam7 interlace; expands to RGBA. 16-bit precision and ignored profile metadata are diagnosed. APNG is rejected. |
| GIF | Composited animation, disposal, interlace and loops; bounded LZW import. |
| ASE (Aseprite) | A **declared supported subset**. Unknown chunks and unsupported data are diagnosed; strict ASE export blocks unmodeled source metadata, so passthrough groups must be made isolated explicitly before strict ASE export. External references are not auto-fetched. Embedded tilemap interchange is not fully certified. |
| `.pxkeys` / `.pxbrush` | Portable keyboard-binding and brush-preset files. Brush/dynamics presets are stored separately from `.pvc` artwork — export presets for portability. |

## Export

- **PNG** — single frames, frame sequences, and sprite sheets with companion JSON metadata.
- **GIF** — animated export with reported timing, alpha and color conversions.
- **ASE** — supported-subset export (`EncodeASEResult`).
- **Atlas** — `createAtlas`/`exportMetadata` produce packed atlases; the UI consumes the same compositor as atlas/GIF export.

Details of PNG/GIF byte-level rules and diagnosed cases are in the [compatibility matrix](/compatibility-matrix).

## Safety notes

- All codecs are **synchronous**. Limits reduce allocation risk, but this is not a formally audited hostile-file processor.
- Do not enable automatic imports of untrusted batches.
- PNG/GIF decoding in tests was additionally verified with Pillow (see [Verification](/verification)).
