import { WebMercatorViewport } from "@deck.gl/core";
import type { MapViewState, TileIndex, TileSize } from "../types";
import type { RequestTile } from "./types";

export type VisibleRange = {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  zoom: number;
};

function lngToTileX(lng: number, z: number): number {
  return Math.floor(((lng + 180) / 360) * (1 << z));
}

function latToTileY(lat: number, z: number): number {
  const latRad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
      (1 << z),
  );
}

export function computeVisibleRange(
  viewState: MapViewState,
  viewportSize: TileSize,
  zoom: number,
): VisibleRange {
  const viewport = new WebMercatorViewport({
    ...viewState,
    width: Math.max(1, viewportSize.width),
    height: Math.max(1, viewportSize.height),
  });

  const corners = [
    viewport.unproject([0, 0]),
    viewport.unproject([viewportSize.width, 0]),
    viewport.unproject([0, viewportSize.height]),
    viewport.unproject([viewportSize.width, viewportSize.height]),
  ];

  let lngMin = Infinity;
  let lngMax = -Infinity;
  let latMin = Infinity;
  let latMax = -Infinity;

  for (const [lng, lat] of corners) {
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      lngMin = Math.min(lngMin, lng);
      lngMax = Math.max(lngMax, lng);
      latMin = Math.min(latMin, lat);
      latMax = Math.max(latMax, lat);
    }
  }

  if (!Number.isFinite(lngMin)) {
    const cx = lngToTileX(viewState.longitude, zoom);
    const cy = latToTileY(viewState.latitude, zoom);
    return { xMin: cx - 2, xMax: cx + 2, yMin: cy - 2, yMax: cy + 2, zoom };
  }

  const maxTile = (1 << zoom) - 1;
  const buffer = 1;
  return {
    xMin: Math.max(0, lngToTileX(lngMin, zoom) - buffer),
    xMax: Math.min(maxTile, lngToTileX(lngMax, zoom) + buffer),
    yMin: Math.max(0, latToTileY(latMax, zoom) - buffer),
    yMax: Math.min(maxTile, latToTileY(latMin, zoom) + buffer),
    zoom,
  };
}

export function tileOverlapsRange(index: TileIndex, range: VisibleRange): boolean {
  const dz = range.zoom - index.z;

  if (dz === 0) {
    return (
      index.x >= range.xMin &&
      index.x <= range.xMax &&
      index.y >= range.yMin &&
      index.y <= range.yMax
    );
  }

  if (dz > 0) {
    // Tile is coarser: check if any descendant at range.zoom overlaps
    const scale = 1 << dz;
    const childXMin = index.x * scale;
    const childXMax = childXMin + scale - 1;
    const childYMin = index.y * scale;
    const childYMax = childYMin + scale - 1;
    return (
      childXMax >= range.xMin &&
      childXMin <= range.xMax &&
      childYMax >= range.yMin &&
      childYMin <= range.yMax
    );
  }

  // Tile is finer: check if its ancestor at range.zoom overlaps
  const scale = 1 << -dz;
  const ancestorX = Math.floor(index.x / scale);
  const ancestorY = Math.floor(index.y / scale);
  return (
    ancestorX >= range.xMin &&
    ancestorX <= range.xMax &&
    ancestorY >= range.yMin &&
    ancestorY <= range.yMax
  );
}

/**
 * Select tiles to render: only viewport-visible tiles, with LOD parent/child rules.
 * LOD decisions use all cached ready tiles (not just viewport-visible ones) so that
 * a parent at a viewport edge correctly hides when its off-viewport child is loaded.
 */
export function selectVisibleTiles(
  tileMap: Record<string, RequestTile>,
  targetZoom: number,
  range: VisibleRange,
): RequestTile[] {
  const allReady = Object.values(tileMap).filter(
    (t): t is RequestTile & { status: "ready" } =>
      t.status === "ready" && !!t.demTexture && !!t.imageryTexture,
  );

  const readyIds = new Set(allReady.map((t) => t.id));

  const visibleReady = allReady.filter((t) => tileOverlapsRange(t.index, range));

  return visibleReady.filter((tile) => {
    const z = tile.index.z;

    if (z < targetZoom) {
      // Check if all viewport-visible descendants at targetZoom are ready.
      // This correctly handles multi-level zoom jumps where intermediate
      // zoom levels were never loaded (e.g. z8→z10 skipping z9).
      const diff = targetZoom - z;
      const scale = 1 << diff;
      const baseX = tile.index.x * scale;
      const baseY = tile.index.y * scale;

      const xStart = Math.max(baseX, range.xMin);
      const xEnd = Math.min(baseX + scale - 1, range.xMax);
      const yStart = Math.max(baseY, range.yMin);
      const yEnd = Math.min(baseY + scale - 1, range.yMax);

      for (let dx = xStart; dx <= xEnd; dx++) {
        for (let dy = yStart; dy <= yEnd; dy++) {
          if (!readyIds.has(`${targetZoom}/${dx}/${dy}`)) {
            return true;
          }
        }
      }
      return false;
    }

    if (z > targetZoom) {
      let pz = z;
      let px = tile.index.x;
      let py = tile.index.y;
      while (pz > targetZoom) {
        pz--;
        px = Math.floor(px / 2);
        py = Math.floor(py / 2);
        if (readyIds.has(`${pz}/${px}/${py}`)) return false;
      }
      return true;
    }

    return true;
  });
}
