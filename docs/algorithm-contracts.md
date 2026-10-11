# Algorithm contracts — v0.3

## Pattern brushes

Cursor stamp preserves the existing behavior: inverse-transform footprint offsets into the captured brush, skip transparent brush texels, apply ink against the original gesture snapshot.

Source/canvas alignment repeats the brush at native pixel size. For destination canvas pixel (x,y), sample brush texel ((x-sourceX) mod width, (y-sourceY) mod height). SourceX/Y default to the captured rectangle's top-left and are saved in the .pxbrush JSON. Positive modulo defines negative positions. Cel offsets affect buffer mapping, not the pattern lattice.

Destination/stroke alignment uses the first canvas sample minus the brush anchor as the tiling origin. The pattern phase stays fixed for the full gesture and resets for each new stroke. Size/angle alter the coverage footprint, not the native texture lattice. Symmetry mirrors the footprint but evaluates the texture in final canvas coordinates; wrap uses canonical canvas coordinates. Selection clips the final writes. These choices prevent event-to-event texture swimming.

Transparent pattern texels leave destination pixels unchanged. Colored presets retain source RGB; mask presets use foreground. Brush JSON version 1 accepts optional alignment/source fields and remains backward compatible with v0.2 exports. Presets live separately from .pvc artwork.

## Gradient dynamics

Gradient sensor is independent of size/opacity/angle sensor:
- Pressure: normalize pen pressure between configured thresholds; mouse/touch use constant full input, not invented hardware pressure.
- Velocity: derive canvas distance / timestamp delta, normalize by velocityMax, then invert (faster input tends toward the low stop).
- Stroke length: normalized accumulated arc length across the final spaced path, including the release flush. Preview recomputes the currently visible path from the original artwork.

Low/high positions can reverse the ramp. Continuous stops interpolate straight RGBA bytes in encoded sRGB and round once; discrete stops select the nearest ramp index. The ramp is FG→BG or an explicit palette order, excluding transparent entries in the editor's palette mode. In indexed artwork the resulting RGBA maps to a nearest available index without editing the palette. Partial alpha is quantized by the indexed target policy.

When gradient color is enabled it replaces a colored brush's RGB but retains its alpha mask. Existing per-gesture maximum coverage avoids opacity accumulation from repeated events. Equal-coverage later stamps can replace color, so cursor-stamp patterns follow deterministic arc-length stamping order. Ramps are limited to 256 valid RGBA stops. Sensor output, spacing, selection, links and rollback have independent fixtures. Physical stylus behavior is not calibrated by simulated Chromium input.

## Pixel-vote transforms

Nearest is unchanged and remains the default. Pixel-vote samples a 3×3 grid of destination offsets {-1/3,0,+1/3} about each destination center, inverse-mapped to original source pixels. Center weight is 3; the eight other samples have weight 1, giving 11 weighted votes. Aggregate exact raw tuples: RGBA, gray/value-alpha pairs, or palette indices. Out-of-image/outside-selection samples vote transparent. Highest count wins; ties prefer center, then first row-major encountered tuple.

Foreground-retention bias: if transparent wins but the center is nontransparent and has at least 3 weighted votes, retain the center tuple. It can preserve thin foreground details over transparency but can thicken edges. A competing opaque majority can suppress a small contrasting feature. No new blended colors are generated. This is an optional style/quality tradeoff, **not universally superior**.

Lattice-aligned unit quarter turns and identity use the nearest shortcut when inverse-center probes establish a signed-permutation lattice mapping. They retain exact bytes. Original-input previews prevent successive preview adjustments from repeatedly resampling their own output. Selection/copy rules, expanded bounds and shared cel placement offsets follow transformAdvanced. Pixel-vote is limited to one megapixel output for synchronous responsiveness; larger output requires nearest or future worker processing.

Gold fixtures include: a 3×3 isolated pivot pixel rotated 45° yields 5×5 bounds at origin (-1,-1), with only local (2,2) opaque; a 3×3 blue field with red center scaled to half has eight blue neighborhood votes against center-red weight three. The latter differs from nearest and documents the contrasting-detail tradeoff rather than claiming improvement on every input.
