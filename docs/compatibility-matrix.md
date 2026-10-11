# Compatibility hardening — v0.4

This is a tested supported subset, not a formally audited hostile-file processor.

## PNG

Import: standard types 0/2/3/4/6; legal 1/2/4/8/16-bit depths per type; packed low-bit samples, palette/tRNS, RGB/grayscale transparency keys, all five filters, and Adam7 passes. RGB/alpha values expand to 8-bit RGBA. Full 16-bit transparency comparison occurs before channel reduction. 16-bit input emits a precision-loss warning. ICC/gamma/chromaticity metadata is not applied and is diagnosed; preservation is not color-managed rendering.

Strict checks: signature, CRC, first/single IHDR, palette ordering, tRNS type/length, contiguous IDAT, mandatory IEND, no trailing bytes, unknown critical chunks, bounded dimensions/scanlines/zlib output and checksum. APNG is explicitly rejected rather than silently importing its first frame. Maximum editing dimensions 8192 and area 16,777,216 pixels.

Fixtures: Pillow-produced indexed/one-bit PNGs; independent Python struct/zlib four-bit, RGB16 and Adam7 files; Pillow RGBA comparison where supported. RGB16+tRNS uses a full-word manual golden because Pillow's RGB16-to-RGBA conversion did not retain that transparency comparison in this environment. The fixture source/golden rule is recorded in scripts/generate-codec-fixtures.py.

## GIF

Import: 87a/89a signatures, global/local palettes, bounded LSB LZW dictionary chains, partial image rectangles, transparency, interlace, disposal 0/1/2/3, Netscape/ANIMEXTS repeat metadata. Frames become composited RGBA raster cels. Zero or unspecified delays use a diagnosed 100ms editing fallback. Non-square pixel-aspect and user-input waiting metadata are diagnosed but not applied. Plain-text rendering is rejected, not guessed.

Export: explicit unknown-frame rejection, a reserved transparent palette slot, opaque color quantization without accidentally mapping opaque pixels to transparent, alpha threshold, disposal 2, finite/infinite/once loop planning. Forward/reverse finite looping retains one frame traversal plus the GIF extra-iteration count; finite pingpong is deliberately expanded into a once-only sequence. Centisecond timing uses accumulated-error compensation with 10ms minimum. Timing, alpha and RGB changes return loss diagnostics; the UI asks before accepting those conversions. Native projects preserve the maximum GIF delay (655350ms) and 65536 total forward traversals; ASE export rejects values beyond its own narrower fields.

Limits: input 128MiB, per-image compressed subblocks 64MiB, 4096 frames, total composited frame data 256MiB. Synchronous decoding still needs broader CPU/heap adversarial testing. Comment/application metadata other than recognized looping is not preserved as editable project metadata.

Independent corpus: Pillow transparent disposal-2 animation, disposal-3 restoration animation, interlaced dictionary-growth image. Exported animation was independently inspected by Pillow for pixels/frame count/loop metadata. Browser interaction tests use Chromium, not a browser-wide certification.

## ASE / .aseprite

Strict sizes/counts/magic, editable dimension/frame bounds, per-cel and aggregate decoded budgets, iterative cached link resolution/cycle rejection, exact raw/compressed cel handling, actual shared-image identity on export, independent imported placement offsets, header-dependent layer/group opacity, isolated groups, cel z-order within compositing contexts, future-frame slice keys, palette changes after frame headers with frame-zero snapshots and previous-frame palette state.

Supported tilemaps: 32-bit self-described nonoverlapping masks; embedded tilesets; file tileset index independent from tileset ID and UI base index; canonical native tile zero empty; legacy 0xffffffff empties normalized with a reserved empty slot; X/Y and square diagonal transforms. Non-square diagonal transforms and non-32-bit tilemap values are explicitly rejected instead of stretched/reinterpreted. Tilemap content links are diagnosed as unmodeled for editing and block strict rewriting. External tilesets are not auto-fetched.

Unsafe rewrites blocked: unknown chunks, unsupported profiles/gamma/ICC, external references, precise cel geometry, UUID/reference/movement-lock metadata that the model cannot preserve, unsupported user-data owners/properties/names, unresolved links and passthrough-group semantics. Metadata is **not byte-preserved**. The original user file remains untouched; native saves store the imported supported model and diagnostics, not an archival copy of omitted source chunks. Keep originals.

Writer checks: UTF-8 length fields, signed cel coordinates/z, duration/pixel ratio/repeat ranges and model references. Imported equal-origin links use an editor placement group; same-image/different-origin cels share pixels but retain independent placement. Group opacity/blend and nested isolation are composited by the shared CPU renderer; exact desktop rounding/group-z boundary behavior remains unverified.

Independent fixtures: manually constructed raw ASE cel/header with legacy timing offsets; Python-generated legacy tileset ID 42/layer index 0/base index 42/empty sentinel; semantic tests for sharing, future slices, palette timelines, flips, group opacity and stricter exports.

## Native .pvc / tilemaps

ZIP preflight checks member paths/counts/sizes, aggregate allocation claims, duplicate names and central-directory bounds. Post-decode member length and CRC are verified. Raster and tile buffers roundtrip; diagnostic limitations remain attached. Tile index zero is always empty; baseIndex changes labels only, never lookup or garbage collection. Corrupt import is validated before replacing the active editor project. Native saves use manifest member `pvc.json` with format tag `pivo-craft/pvc`; no legacy extension aliases exist.

## Still outside this release

Full ICC color rendering, APNG animation, GIF plain-text fonts/interactive waiting, arbitrary external tilesets, general unknown-chunk preservation, exact desktop conformance, physical stylus coverage, Firefox/Safari verification, formal security/accessibility audit and production performance certification. Codec operations remain synchronous.
