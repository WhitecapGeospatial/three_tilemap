import type { UVBounds } from "./types";

/**
 * Compute the UV window that a render-zoom cell (localX, localY) occupies
 * within its parent request tile at `scale = 2^(maxRenderZoom - sourceZoom)`.
 *
 * The returned bounds describe the cell's full geographic footprint in the
 * parent's [0,1]² UV space. Downstream mesh shaders apply their own
 * inset/buffer offsets within this window.
 *
 * V axis follows Web Mercator tile convention: localY=0 is the northern
 * (top) row, so it maps to the highest V values.
 */
export function resolveUVBounds(
  localX: number,
  localY: number,
  scale: number,
): UVBounds {
  return {
    uMin: localX / scale,
    uMax: (localX + 1) / scale,
    vMin: (scale - 1 - localY) / scale,
    vMax: (scale - localY) / scale,
  };
}
