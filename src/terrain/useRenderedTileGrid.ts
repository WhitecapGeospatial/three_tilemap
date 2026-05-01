import { useMemo, useRef } from "react";
import { WebMercatorViewport } from "@deck.gl/core";
import type { MapViewState, TileSize } from "../types";
import type {
  RequestTile,
  UVBounds,
  RenderedTile,
  RenderedEdgeRecord,
  RenderedCornerRecord,
} from "./types";
import { tileToLngLatBounds } from "../utils/tileMath";

const BASE_SEGMENTS = 16;
const MIN_SEGMENTS = 4;

function resolveSource(
  rx: number,
  ry: number,
  maxRenderZoom: number,
  minRequestZoom: number,
  cache: Map<string, RequestTile>,
): { requestTile: RequestTile; uvBounds: UVBounds; sourceZoom: number } | null {
  for (let z = maxRenderZoom; z >= minRequestZoom; z--) {
    const scale = 1 << (maxRenderZoom - z);
    const tx = Math.floor(rx / scale);
    const ty = Math.floor(ry / scale);
    const tile = cache.get(`${z}/${tx}/${ty}`);
    if (tile?.status === "ready" && tile.demTexture && tile.imageryTexture) {
      const localX = rx - tx * scale;
      const localY = ry - ty * scale;
      return {
        requestTile: tile,
        uvBounds: {
          uMin: localX / scale,
          uMax: (localX + 1) / scale,
          vMin: localY / scale,
          vMax: (localY + 1) / scale,
        },
        sourceZoom: z,
      };
    }
  }
  return null;
}

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
  maxRenderZoom: number,
): { xMin: number; xMax: number; yMin: number; yMax: number } {
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
    const cx = lngToTileX(viewState.longitude, maxRenderZoom);
    const cy = latToTileY(viewState.latitude, maxRenderZoom);
    return { xMin: cx - 2, xMax: cx + 2, yMin: cy - 2, yMax: cy + 2 };
  }

  const maxTile = (1 << maxRenderZoom) - 1;
  const buffer = 1;
  return {
    xMin: Math.max(0, lngToTileX(lngMin, maxRenderZoom) - buffer),
    xMax: Math.min(maxTile, lngToTileX(lngMax, maxRenderZoom) + buffer),
    yMin: Math.max(0, latToTileY(latMax, maxRenderZoom) - buffer),
    yMax: Math.min(maxTile, latToTileY(latMin, maxRenderZoom) + buffer),
  };
}

function effectiveSegments(
  maxRenderZoom: number,
  lowestSourceZoom: number,
): number {
  const delta = maxRenderZoom - lowestSourceZoom;
  return Math.max(MIN_SEGMENTS, BASE_SEGMENTS >> delta);
}

function neighborMinZoom(
  rx: number,
  ry: number,
  grid: Map<string, RenderedTile>,
): number {
  let min = Infinity;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const n = grid.get(`${rx + dx}/${ry + dy}`);
      if (n) min = Math.min(min, n.source.sourceZoom);
    }
  }
  return min;
}

type RenderedTileGridResult = {
  renderedTiles: RenderedTile[];
  edgeRecords: RenderedEdgeRecord[];
  cornerRecords: RenderedCornerRecord[];
};

export function useRenderedTileGrid(
  requestTileCache: Map<string, RequestTile>,
  viewState: MapViewState,
  viewportSize: TileSize,
  minRequestZoom: number,
  maxRenderZoom: number,
): RenderedTileGridResult {
  const committedRef = useRef<Map<string, RenderedTile>>(new Map());

  const { renderedTiles, renderedGrid } = useMemo(() => {
    const range = computeVisibleRange(viewState, viewportSize, maxRenderZoom);
    const pending = new Map<string, RenderedTile>();

    for (let x = range.xMin; x <= range.xMax; x++) {
      for (let y = range.yMin; y <= range.yMax; y++) {
        const source = resolveSource(
          x, y, maxRenderZoom, minRequestZoom, requestTileCache,
        );
        if (source) {
          const id = `${x}/${y}`;
          pending.set(id, {
            id,
            renderIndex: { x, y },
            segments: 0,
            source,
          });
        }
      }
    }

    const committed = committedRef.current;
    const next = new Map<string, RenderedTile>();

    for (const [id, pendingTile] of pending) {
      const prev = committed.get(id);
      if (!prev) {
        next.set(id, pendingTile);
        continue;
      }

      if (pendingTile.source.sourceZoom <= prev.source.sourceZoom) {
        next.set(id, pendingTile);
        continue;
      }

      const { x, y } = pendingTile.renderIndex;
      let canUpgrade = true;
      for (let dx = -1; dx <= 1 && canUpgrade; dx++) {
        for (let dy = -1; dy <= 1 && canUpgrade; dy++) {
          const nId = `${x + dx}/${y + dy}`;
          const neighbor = pending.get(nId);
          if (neighbor && neighbor.source.sourceZoom < pendingTile.source.sourceZoom) {
            canUpgrade = false;
          }
        }
      }

      next.set(id, canUpgrade ? pendingTile : prev);
    }

    for (const tile of next.values()) {
      const localMin = neighborMinZoom(tile.renderIndex.x, tile.renderIndex.y, next);
      tile.segments = effectiveSegments(maxRenderZoom, localMin);
    }

    committedRef.current = next;
    return { renderedTiles: Array.from(next.values()), renderedGrid: next };
  }, [requestTileCache, viewState, viewportSize, minRequestZoom, maxRenderZoom]);

  const { edgeRecords, cornerRecords } = useMemo(() => {
    const edges: RenderedEdgeRecord[] = [];
    const corners: RenderedCornerRecord[] = [];

    for (const tile of renderedTiles) {
      const { x, y } = tile.renderIndex;
      const eastId = `${x + 1}/${y}`;
      const southId = `${x}/${y + 1}`;
      const seId = `${x + 1}/${y + 1}`;

      const east = renderedGrid.get(eastId);
      const south = renderedGrid.get(southId);
      const se = renderedGrid.get(seId);

      if (east) {
        edges.push({
          id: `edge-east-${tile.id}`,
          direction: "east",
          segments: Math.min(tile.segments, east.segments),
          tileA: tile,
          tileB: east,
        });
      }
      if (south) {
        edges.push({
          id: `edge-south-${tile.id}`,
          direction: "south",
          segments: Math.min(tile.segments, south.segments),
          tileA: tile,
          tileB: south,
        });
      }
      if (east && south && se) {
        corners.push({
          id: `corner-${tile.id}`,
          segments: Math.min(tile.segments, east.segments, south.segments, se.segments),
          nw: tile,
          ne: east,
          sw: south,
          se,
        });
      }
    }

    return { edgeRecords: edges, cornerRecords: corners };
  }, [renderedTiles, renderedGrid]);

  return { renderedTiles, edgeRecords, cornerRecords };
}
