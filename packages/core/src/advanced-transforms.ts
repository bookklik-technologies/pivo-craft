// Advanced transform for PiVo Craft core.
//
// Formula policy:
// The forward transform maps canvas-space point (x, y) as
//   X = dx + pivotX' + ( cosA * (x - pivotX') * scaleX - sinA * (y - pivotY') * scaleY )
//   Y = dy + pivotY' + ( sinA * (x - pivotX') * scaleX + cosA * (y - pivotY') * scaleY )
// with A in degrees measured CLOCKWISE in screen coordinates (y axis points down)
// and the pivot interpreted as a pixel, i.e. its center (pivotX + 0.5, pivotY + 0.5).
// Rasterization samples the ORIGINAL source snapshot through the exact inverse
// mapping with nearest-neighbor (unit-square) sampling. Preview workflows must
// clone the project per gesture: this function never resamples its own output,
// so repeated calls accumulate no resampling error beyond one deterministic pass.
// Pixels are copied byte-for-byte — no blending, no color conversion, no blur.
import type { Project } from './types.ts';
import { assert, bpp, findLayer } from './util.ts';
import { effectiveLocked, getCel, MAX_AREA, MAX_DIM } from './document.ts';

export interface AdvancedTransformOptions {
  /** Rotation in degrees, clockwise in screen coordinates (y down). */
  angle: number;
  scaleX: number;
  scaleY: number;
  /** Translation applied after rotate+scale, in canvas pixels. */
  dx: number;
  dy: number;
  /** Pivot in canvas coordinates (interpreted as a pixel; its center is used). */
  pivotX: number;
  pivotY: number;
  /** Canvas-space byte mask (255 = selected). Masked pixels move; the rest is preserved. */
  selection?: Uint8Array | null;
  /** When true, selected source pixels are kept in place as well as transformed. */
  copy?: boolean;
  /**
   * Destination resampling method. Default 'nearest' (exact inverse nearest
   * neighbor, byte-for-byte, fully backward compatible). 'pixel-vote' is
   * a palette-preserving vote method — see the destination-pass notes below.
   * No blanket-superiority claim is made.
   */
  resampling?: 'nearest' | 'pixel-vote';
}

interface ContinuousRect { x0: number; y0: number; x1: number; y1: number }

/**
 * Arbitrary affine transform of the cel at (layerId, frameId).
 * Returns the resulting canvas-space selection mask when a selection was given
 * (covering the transformed destination of the selected pixels, clipped to the
 * canvas), or null when no selection was given.
 *
 * Bounds: the output buffer expands to contain both the preserved content and
 * the transformed region, capped at MAX_DIM x MAX_DIM / MAX_AREA pixels.
 * Shared content: the image buffer is replaced exactly once; every cel that
 * references the same image has its origin shifted by the same output origin
 * delta, preserving imported placement offsets between same-image cels.
 * With resampling 'pixel-vote' the returned destination mask records a
 * destination pixel only when at least one valid selected vote existed there
 * (never for arbitrary background margin fill).
 * Rejections (before any mutation): nonfinite or singular inputs, unsupported
 * resampling strings, bounds beyond the safety caps, group/tilemap/background
 * layers, locked layers (locks are inherited through group ancestors).
 */
export function transformAdvanced(
  p: Project,
  layerId: string,
  frameId: string,
  options: AdvancedTransformOptions,
): Uint8Array | null {
  const { angle, scaleX, scaleY, dx, dy, pivotX, pivotY } = options;

  // --- prevalidation: reject nonfinite / singular / extreme inputs up front ---
  const scalars: Array<[string, number]> = [
    ['angle', angle], ['scaleX', scaleX], ['scaleY', scaleY],
    ['dx', dx], ['dy', dy], ['pivotX', pivotX], ['pivotY', pivotY],
  ];
  for (const [name, v] of scalars) {
    if (!Number.isFinite(v)) throw new Error(`transformAdvanced: ${name} must be finite (got ${v})`);
  }
  if (Math.abs(scaleX) < 1e-12 || Math.abs(scaleY) < 1e-12) {
    throw new Error('transformAdvanced: scale is singular (zero scale factor)');
  }
  if (Math.abs(dx) > MAX_DIM || Math.abs(dy) > MAX_DIM) {
    throw new Error('transformAdvanced: translation is extreme (beyond the 8192 canvas cap)');
  }
  const selection = options.selection ?? null;
  if (selection && selection.length !== p.width * p.height) {
    throw new Error('transformAdvanced: selection mask must be canvas-sized');
  }
  const copy = options.copy === true;
  // Unsupported resampling strings reject before any mutation (backward compat:
  // 'nearest' is the implicit default when the option is omitted entirely).
  const resampling = options.resampling ?? 'nearest';
  if (resampling !== 'nearest' && resampling !== 'pixel-vote') {
    throw new Error(`transformAdvanced: unsupported resampling ${JSON.stringify(resampling)} (expected 'nearest' or 'pixel-vote')`);
  }

  // --- layer validation, still mutation-free ---
  const layer = findLayer(p, layerId);
  if (layer.kind === 'group') throw new Error('transformAdvanced: cannot transform a group layer');
  if (layer.kind === 'tilemap') throw new Error('transformAdvanced: tilemap layers require tile-aware operations');
  if (layer.background) throw new Error('transformAdvanced: the background layer cannot be transformed');
  if (effectiveLocked(p, layerId)) throw new Error(`transformAdvanced: layer ${layer.name} is locked`);

  const cel = getCel(p, layerId, frameId);
  const emptyMask = () => (selection ? new Uint8Array(p.width * p.height) : null);
  if (!cel) return emptyMask();
  const img = p.images[cel.imageId];
  assert(img, 'transformAdvanced: cel missing image');
  if (img.width === 0 || img.height === 0) return emptyMask();

  const bytes = bpp(p.mode);
  const rad = ((angle % 360) * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const pcx = pivotX + 0.5;
  const pcy = pivotY + 0.5;
  const fwdX = (x: number, y: number): number =>
    dx + pcx + (c * (x - pcx) * scaleX - s * (y - pcy) * scaleY);
  const fwdY = (x: number, y: number): number =>
    dy + pcy + (s * (x - pcx) * scaleX + c * (y - pcy) * scaleY);
  const invX = (X: number, Y: number): number => {
    const u = X - dx - pcx;
    const v = Y - dy - pcy;
    return pcx + (c * u + s * v) / scaleX;
  };
  const invY = (X: number, Y: number): number => {
    const u = X - dx - pcx;
    const v = Y - dy - pcy;
    return pcy + (-s * u + c * v) / scaleY;
  };

  const isSel = (cx: number, cy: number): boolean =>
    selection !== null && cx >= 0 && cy >= 0 && cx < p.width && cy < p.height &&
    selection[cy * p.width + cx] !== 0;

  // Source region that participates in the transform (canvas-space, continuous).
  let srcArea: ContinuousRect;
  if (selection) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let ly = 0; ly < img.height; ly++) {
      for (let lx = 0; lx < img.width; lx++) {
        if (isSel(lx + cel.x, ly + cel.y)) {
          if (lx < minX) minX = lx;
          if (lx > maxX) maxX = lx;
          if (ly < minY) minY = ly;
          if (ly > maxY) maxY = ly;
        }
      }
    }
    if (minX === Infinity) return emptyMask(); // nothing selected: documented no-op
    srcArea = { x0: minX + cel.x, y0: minY + cel.y, x1: maxX + 1 + cel.x, y1: maxY + 1 + cel.y };
  } else {
    srcArea = { x0: cel.x, y0: cel.y, x1: cel.x + img.width, y1: cel.y + img.height };
  }

  // Transformed destination bounds from the source area corners (continuous space).
  const cxs = [fwdX(srcArea.x0, srcArea.y0), fwdX(srcArea.x1, srcArea.y0), fwdX(srcArea.x0, srcArea.y1), fwdX(srcArea.x1, srcArea.y1)];
  const cys = [fwdY(srcArea.x0, srcArea.y0), fwdY(srcArea.x1, srcArea.y0), fwdY(srcArea.x0, srcArea.y1), fwdY(srcArea.x1, srcArea.y1)];
  const tX0 = Math.floor(Math.min(...cxs) + 1e-9);
  const tX1 = Math.ceil(Math.max(...cxs) - 1e-9);
  const tY0 = Math.floor(Math.min(...cys) + 1e-9);
  const tY1 = Math.ceil(Math.max(...cys) - 1e-9);

  // Does anything get preserved in place? With a selection: unselected pixels
  // (or everything when copying). Without a selection the whole source is the
  // move-source and is replaced, so the output is exactly the destination.
  let hasPreserved = copy;
  if (selection) {
    if (copy) {
      hasPreserved = true;
    } else {
      for (let ly = 0; ly < img.height && !hasPreserved; ly++) {
        for (let lx = 0; lx < img.width; lx++) {
          if (!isSel(lx + cel.x, ly + cel.y)) { hasPreserved = true; break; }
        }
      }
    }
  }

  // Output bounds: preserved content area union transformed destination area.
  const outX0 = hasPreserved ? Math.min(cel.x, tX0) : tX0;
  const outY0 = hasPreserved ? Math.min(cel.y, tY0) : tY0;
  const outX1 = hasPreserved ? Math.max(cel.x + img.width, tX1) : tX1;
  const outY1 = hasPreserved ? Math.max(cel.y + img.height, tY1) : tY1;
  const outW = outX1 - outX0;
  const outH = outY1 - outY0;
  if (![outX0,outY0,outX1,outY1,outW,outH].every(Number.isFinite) || outW<1 || outH<1 || outW > MAX_DIM || outH > MAX_DIM || outW * outH > MAX_AREA) {
    throw new Error(`transformAdvanced: output bounds ${outW}x${outH} exceed the ${MAX_DIM}/${MAX_AREA} safety caps`);
  }

  if(resampling==='pixel-vote' && outW*outH>1048576)throw new Error('Pixel-vote preview is limited to one megapixel');
  // --- all validation passed; compute, then commit ---
  const snap = new Uint8Array(img.data); // ORIGINAL source snapshot: every sample comes from here
  const out = new Uint8Array(outW * outH * bytes);
  const fill = p.mode === 'indexed' ? (p.transparentIndex & 255) : 0;
  if (fill !== 0) out.fill(fill); // indexed transparent/background fill; RGBA/gray fill is 0

  // Preserve content that is not a move-source: unselected pixels, or everything
  // when copying. With no selection the transformed content replaces the source.
  for (let ly = 0; ly < img.height; ly++) {
    for (let lx = 0; lx < img.width; lx++) {
      const cx = lx + cel.x;
      const cy = ly + cel.y;
      const selected = selection ? isSel(cx, cy) : false;
      const preserve = selection ? (!selected || copy) : copy;
      if (!preserve) continue;
      const d = ((cy - outY0) * outW + (cx - outX0)) * bytes;
      const sOff = (ly * img.width + lx) * bytes;
      for (let b = 0; b < bytes; b++) out[d + b] = snap[sOff + b]!;
    }
  }

  // Destination pass: inverse sampling from the ORIGINAL snapshot. Two methods:
  //
  // 'nearest' — exact inverse nearest-neighbor at the destination pixel center
  // (the historical behavior, byte-for-byte unchanged).
  //
  // 'pixel-vote' — a palette-preserving vote method. No blanket superiority
  // claim is made. For each destination pixel it samples
  // a 3x3 neighborhood of destination offsets {-1/3, 0, +1/3} around the pixel
  // center through the same exact inverse mapping, aggregates counts of the
  // exact raw source tuples (1/2/4 bytes — never averaged, never a new color),
  // and writes the winning tuple. Samples that fall out of the image or outside
  // the selection become transparent votes. The center offset carries weight 3,
  // the other eight carry weight 1 (11 weighted votes total); ties prefer the
  // center tuple, then the first row-major-encountered tuple.
  //
  // Explicit foreground-retention bias: when the transparent tuple wins but the
  // center tuple is opaque and holds >= 3 of the 11 weighted votes, the center
  // tuple is chosen anyway. This deliberately retains thin foreground details
  // that a symmetric vote would erase; the tradeoff is that it can thicken
  // rotated edges, so it is not universally better — it is a documented bias,
  // not an objective improvement.
  //
  // Lattice shortcut: for identity / unit-scale quarter turns with integer
  // translation and an integer (half-grid-centered) pivot, the inverse of every
  // destination pixel center lands exactly on a source pixel center, so the
  // vote degenerates to exact nearest sampling. We detect that case and take
  // the nearest path directly, guaranteeing byte-exact roundtrips across four
  // 90-degree transforms.
  const maskOut = selection ? new Uint8Array(p.width * p.height) : null;
  const transparentByte = p.mode === 'indexed' ? (p.transparentIndex & 255) : 0;
  const transparentTuple: number[] = new Array(bytes).fill(transparentByte);
  const tupleIsTransparent = (t: number[]): boolean =>
    p.mode === 'indexed'
      ? t[0] === transparentByte
      : p.mode === 'gray' ? t[1] === 0 : t[3] === 0;
  const tupleIsOpaque = (t: number[]): boolean =>
    p.mode === 'rgba' ? t[3]! > 0
      : p.mode === 'gray' ? t[1]! > 0
        : t[0] !== transparentByte;

  let useNearest = resampling === 'nearest';
  if (resampling === 'pixel-vote') {
    // Affine map: checking the constant term and the two linear coefficients
    // (via finite differences at pixel-center probes) fully determines whether
    // every destination center maps to a source center. Unit scale requires a
    // signed-permutation linear part (entries in {-1, 0, 1}, exactly one
    // nonzero per row); invertibility guarantees the columns too.
    const eps = 1e-6;
    const x00 = invX(0.5, 0.5) - 0.5;
    const kxx = invX(1.5, 0.5) - invX(0.5, 0.5);
    const kxy = invX(0.5, 1.5) - invX(0.5, 0.5);
    const y00 = invY(0.5, 0.5) - 0.5;
    const kyx = invY(1.5, 0.5) - invY(0.5, 0.5);
    const kyy = invY(0.5, 1.5) - invY(0.5, 0.5);
    const latticeOk = (v: number): boolean =>
      Number.isFinite(v) && Math.abs(v - Math.round(v)) < eps;
    const permRow = (a: number, b: number): boolean =>
      (Math.abs(Math.abs(a) - 1) < eps && Math.abs(b) < eps) ||
      (Math.abs(Math.abs(b) - 1) < eps && Math.abs(a) < eps);
    useNearest =
      latticeOk(x00) && latticeOk(y00) &&
      permRow(kxx, kxy) && permRow(kyx, kyy);
  }

  if (useNearest) {
    for (let ty = tY0; ty < tY1; ty++) {
      for (let tx = tX0; tx < tX1; tx++) {
        const srcCx = invX(tx + 0.5, ty + 0.5);
        const srcCy = invY(tx + 0.5, ty + 0.5);
        const sxr = Math.floor(srcCx);
        const syr = Math.floor(srcCy);
        if (sxr < cel.x || syr < cel.y || sxr >= cel.x + img.width || syr >= cel.y + img.height) continue;
        if (selection && !isSel(sxr, syr)) continue;
        const d = ((ty - outY0) * outW + (tx - outX0)) * bytes;
        const sOff = ((syr - cel.y) * img.width + (sxr - cel.x)) * bytes;
        for (let b = 0; b < bytes; b++) out[d + b] = snap[sOff + b]!;
        if (maskOut && tx >= 0 && ty >= 0 && tx < p.width && ty < p.height) {
          maskOut[ty * p.width + tx] = 255;
        }
      }
    }
  } else {
    // 'pixel-vote': 3x3 destination-offset neighborhood vote per destination pixel.
    const OFFS = [-1 / 3, 0, 1 / 3];
    for (let ty = tY0; ty < tY1; ty++) {
      for (let tx = tX0; tx < tX1; tx++) {
        const cx = tx + 0.5;
        const cy = ty + 0.5;
        // Insertion-ordered aggregation: exact tuples only, first row-major
        // encounter order decides tie-breaks (after the center preference).
        const counts = new Map<string, { count: number; tuple: number[] }>();
        let centerKey: string | null = null;
        let anyValid = false;
        for (const oy of OFFS) {
          for (const ox of OFFS) {
            const srcCx = invX(cx + ox, cy + oy);
            const srcCy = invY(cx + ox, cy + oy);
            const sxr = Math.floor(srcCx);
            const syr = Math.floor(srcCy);
            const inImg = sxr >= cel.x && syr >= cel.y &&
              sxr < cel.x + img.width && syr < cel.y + img.height;
            const valid = inImg && (!selection || isSel(sxr, syr));
            if (valid) anyValid = true;
            const weight = ox === 0 && oy === 0 ? 3 : 1;
            const tuple = valid
              ? Array.from(snap.subarray(
                ((syr - cel.y) * img.width + (sxr - cel.x)) * bytes,
                ((syr - cel.y) * img.width + (sxr - cel.x)) * bytes + bytes,
              ))
              : transparentTuple; // out-of-image / outside-selection: transparent vote
            const key = tuple.join(',');
            if (ox === 0 && oy === 0) centerKey = key;
            const entry = counts.get(key);
            if (entry) entry.count += weight;
            else counts.set(key, { count: weight, tuple });
          }
        }
        if (!anyValid) continue; // no valid selected vote: leave fill, no mask entry
        let bestKey: string | null = null;
        let bestCount = -1;
        for (const [key, entry] of counts) {
          if (entry.count > bestCount) { bestCount = entry.count; bestKey = key; }
        }
        // Tie-break: prefer the center tuple, then first row-major encountered
        // (strict '>' above already keeps the first-encountered on ties).
        if (centerKey !== null && counts.get(centerKey)!.count === bestCount) {
          bestKey = centerKey;
        }
        let chosen = counts.get(bestKey!)!.tuple;
        // Foreground-retention bias (documented above): keep an opaque center
        // tuple with >= 3 of 11 weighted votes over a transparent winner.
        if (tupleIsTransparent(chosen) && centerKey !== null) {
          const centerEntry = counts.get(centerKey)!;
          if (tupleIsOpaque(centerEntry.tuple) && centerEntry.count >= 3) {
            chosen = centerEntry.tuple;
          }
        }
        const d = ((ty - outY0) * outW + (tx - outX0)) * bytes;
        for (let b = 0; b < bytes; b++) out[d + b] = chosen[b]!;
        if (maskOut && tx >= 0 && ty >= 0 && tx < p.width && ty < p.height) {
          maskOut[ty * p.width + tx] = 255;
        }
      }
    }
  }

  // Commit: shared content changes exactly once; every same-image cel origin
  // shifts by the output origin delta so imported placement offsets survive.
  const shiftX = outX0 - cel.x;
  const shiftY = outY0 - cel.y;
  img.data = out;
  img.width = outW;
  img.height = outH;
  cel.x = outX0;
  cel.y = outY0;
  for (const other of p.cels) {
    if (other !== cel && other.imageId === cel.imageId) {
      other.x += shiftX;
      other.y += shiftY;
    }
  }
  p.revision++;
  return maskOut;
}
