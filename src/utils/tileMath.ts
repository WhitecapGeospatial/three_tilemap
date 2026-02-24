import { WebMercatorViewport } from "@deck.gl/core";
import type { MapViewState, TileIndex, TileSize } from "../types";

export type TileLngLatBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type TileWorldBounds = {
  worldMinX: number;
  worldMinY: number;
  worldMaxX: number;
  worldMaxY: number;
  centerX: number;
  centerY: number;
};

export function tileToLngLatBounds(index: TileIndex): TileLngLatBounds {
  const n = Math.pow(2, index.z);
  const west = (index.x / n) * 360 - 180;
  const east = ((index.x + 1) / n) * 360 - 180;

  const northRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * index.y) / n)));
  const southRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * (index.y + 1)) / n)));

  const north = (northRad * 180) / Math.PI;
  const south = (southRad * 180) / Math.PI;

  return { west, south, east, north };
}

type ViewStateWithZoom = {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch?: number;
  bearing?: number;
};

function toViewStateWithZoom(
  viewState: MapViewState | { longitude: number; latitude: number },
  zoomOverride?: number,
): ViewStateWithZoom {
  const zoom = zoomOverride ?? ("zoom" in viewState ? (viewState as MapViewState).zoom : 10);
  return {
    longitude: viewState.longitude,
    latitude: viewState.latitude,
    zoom,
    pitch: "pitch" in viewState ? (viewState as MapViewState).pitch : 0,
    bearing: "bearing" in viewState ? (viewState as MapViewState).bearing : 0,
  };
}

export function tileToWorldBounds(
  viewState: MapViewState | { longitude: number; latitude: number },
  viewportSize: TileSize,
  index: TileIndex,
  zoomOverride?: number,
): TileWorldBounds {
  const vs = toViewStateWithZoom(viewState, zoomOverride);
  const viewport = new WebMercatorViewport({
    ...vs,
    width: Math.max(1, viewportSize.width),
    height: Math.max(1, viewportSize.height),
  });

  const bounds = tileToLngLatBounds(index);
  const nw = viewport.projectPosition([bounds.west, bounds.north, 0]);
  const se = viewport.projectPosition([bounds.east, bounds.south, 0]);

  const worldMinX = Math.min(nw[0], se[0]);
  const worldMaxX = Math.max(nw[0], se[0]);
  const worldMinY = Math.min(nw[1], se[1]);
  const worldMaxY = Math.max(nw[1], se[1]);

  return {
    worldMinX,
    worldMinY,
    worldMaxX,
    worldMaxY,
    centerX: (worldMinX + worldMaxX) * 0.5,
    centerY: (worldMinY + worldMaxY) * 0.5,
  };
}

export function metersToWorldScale(
  viewState: MapViewState | { longitude: number; latitude: number },
  viewportSize: TileSize,
  zoomOverride?: number,
): number {
  const vs = toViewStateWithZoom(viewState, zoomOverride);
  const viewport = new WebMercatorViewport({
    ...vs,
    width: Math.max(1, viewportSize.width),
    height: Math.max(1, viewportSize.height),
  });

  const scale = viewport.distanceScales?.unitsPerMeter?.[2];
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}
