import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TileLayer } from "@deck.gl/geo-layers";
import * as THREE from "three";
import type { DemDecodeParams, MapViewState, TileIndex, TileSize } from "../types";
import type { RequestTile } from "./types";
import {
  computeVisibleRange,
  selectVisibleTiles,
  tileOverlapsRange,
} from "./tileSelection";

const DEM_ENDPOINT =
  "https://cogserver-staging-myzvqet7ua-uw.a.run.app/get_rgb_tile/{z}/{x}/{y}.png?dataset=GlobalTopoBath.tif";
const IMAGERY_ENDPOINT =
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

const SETTLE_MS = 500;

function tileId(index: TileIndex): string {
  return `${index.z}/${index.x}/${index.y}`;
}

function zoomFromTileId(id: string): number {
  return Number.parseInt(id.split("/")[0], 10);
}

function buildDemUrl(index: TileIndex): string {
  return DEM_ENDPOINT.replace("{z}", `${index.z}`)
    .replace("{x}", `${index.x}`)
    .replace("{y}", `${index.y}`);
}

function buildImageryUrl(index: TileIndex): string {
  return IMAGERY_ENDPOINT.replace("{z}", `${index.z}`)
    .replace("{x}", `${index.x}`)
    .replace("{y}", `${index.y}`);
}

type TileTextures = { demTexture: THREE.Texture; imageryTexture: THREE.Texture };

const fetchWorker = new Worker(
  new URL("./tileFetchWorker.ts", import.meta.url),
  { type: "module" },
);

const pendingFetches = new Map<
  string,
  { resolve: (v: TileTextures) => void; reject: (e: Error) => void }
>();

fetchWorker.onmessage = (e: MessageEvent) => {
  const { id } = e.data;

  if (e.data.type === "cancelled") {
    pendingFetches.delete(id);
    return;
  }

  const entry = pendingFetches.get(id);
  if (!entry) return;
  pendingFetches.delete(id);

  if (e.data.type === "error") {
    entry.reject(new Error(e.data.message));
    return;
  }

  const demTexture = new THREE.Texture(e.data.demBitmap);
  demTexture.flipY = true;
  demTexture.colorSpace = THREE.NoColorSpace;
  demTexture.minFilter = THREE.LinearFilter;
  demTexture.magFilter = THREE.LinearFilter;
  demTexture.wrapS = THREE.ClampToEdgeWrapping;
  demTexture.wrapT = THREE.ClampToEdgeWrapping;
  demTexture.needsUpdate = true;

  const imageryTexture = new THREE.Texture(e.data.imageryBitmap);
  imageryTexture.flipY = true;
  imageryTexture.colorSpace = THREE.SRGBColorSpace;
  imageryTexture.minFilter = THREE.LinearFilter;
  imageryTexture.magFilter = THREE.LinearFilter;
  imageryTexture.wrapS = THREE.ClampToEdgeWrapping;
  imageryTexture.wrapT = THREE.ClampToEdgeWrapping;
  imageryTexture.needsUpdate = true;

  entry.resolve({ demTexture, imageryTexture });
};

function cancelTile(id: string) {
  const entry = pendingFetches.get(id);
  if (!entry) return;
  pendingFetches.delete(id);
  fetchWorker.postMessage({ type: "cancel", id });
}

function loadTileTextures(index: TileIndex): Promise<TileTextures> {
  const id = tileId(index);
  cancelTile(id);
  return new Promise((resolve, reject) => {
    pendingFetches.set(id, { resolve, reject });
    fetchWorker.postMessage({
      type: "fetch",
      id,
      demUrl: buildDemUrl(index),
      imageryUrl: buildImageryUrl(index),
    });
  });
}

export function useDeckTileTerrain(
  decodeParams: DemDecodeParams,
  minRequestZoom: number,
  maxRequestZoom: number,
  viewState: MapViewState,
  viewportSize: TileSize,
): {
  layer: TileLayer;
  readyTiles: RequestTile[];
  decodeParams: DemDecodeParams;
} {
  const [tileMap, setTileMap] = useState<Record<string, RequestTile>>({});
  const aliveIds = useRef(new Set<string>());
  const disposalQueue = useRef<THREE.Texture[]>([]);
  const prevTargetZoomRef = useRef<number | null>(null);

  const onTileUnload = useCallback((tile: { index: TileIndex }) => {
    const id = tileId(tile.index);
    aliveIds.current.delete(id);
    setTileMap((prev) => {
      const rec = prev[id];
      if (rec?.demTexture) disposalQueue.current.push(rec.demTexture);
      if (rec?.imageryTexture) disposalQueue.current.push(rec.imageryTexture);
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const onTileLoad = useCallback(
    (tile: { index: TileIndex; data?: TileTextures }) => {
      const id = tileId(tile.index);
      aliveIds.current.add(id);

      const payload = tile.data;
      if (!payload) return;

      const { demTexture, imageryTexture } = payload;

      if (!aliveIds.current.has(id)) {
        demTexture.dispose();
        imageryTexture.dispose();
        return;
      }

      setTileMap((prev) => ({
        ...prev,
        [id]: {
          id,
          index: tile.index,
          status: "ready",
          imageryTexture,
          demTexture,
          lastUsed: performance.now(),
        },
      }));
    },
    [],
  );

  const onTileError = useCallback(
    (_error: unknown, tile: { index: TileIndex }) => {
      const id = tileId(tile.index);
      setTileMap((prev) => ({
        ...prev,
        [id]: {
          id,
          index: tile.index,
          status: "error",
          errorMessage: _error instanceof Error ? _error.message : String(_error),
          lastUsed: performance.now(),
        },
      }));
    },
    [],
  );

  useEffect(() => {
    if (!disposalQueue.current.length) return;
    const handle = requestAnimationFrame(() => {
      disposalQueue.current.splice(0).forEach((t) => t.dispose());
    });
    return () => cancelAnimationFrame(handle);
  });

  const viewZoom = viewState.zoom;
  const targetZoom = Math.min(maxRequestZoom, Math.max(minRequestZoom, Math.round(viewZoom)));

  // Cancel in-flight fetches for zoom levels far from the new target
  useEffect(() => {
    if (prevTargetZoomRef.current === targetZoom) return;
    prevTargetZoomRef.current = targetZoom;

    const toCancel: string[] = [];
    for (const id of pendingFetches.keys()) {
      const z = zoomFromTileId(id);
      if (Math.abs(z - targetZoom) > 1) {
        toCancel.push(id);
      }
    }
    for (const id of toCancel) {
      cancelTile(id);
    }

    if (toCancel.length > 0) {
      setTileMap((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const id of toCancel) {
          if (next[id]?.status === "loading") {
            delete next[id];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }
  }, [targetZoom]);

  const getTileData = useCallback(
    ({ index }: { index: TileIndex }) => loadTileTextures(index),
    [],
  );

  const layer = useMemo(
    () =>
      new TileLayer({
        id: "dem-imagery-tile-layer",
        data: IMAGERY_ENDPOINT,
        tileSize: 256,
        minZoom: minRequestZoom,
        maxZoom: maxRequestZoom,
        maxRequests: 16,
        debounceTime: 50,
        refinementStrategy: "best-available",
        renderSubLayers: () => null,
        getTileData,
        onTileLoad,
        onTileUnload,
        onTileError,
      }),
    [minRequestZoom, maxRequestZoom, getTileData, onTileLoad, onTileUnload, onTileError],
  );

  const visibleRange = useMemo(
    () => computeVisibleRange(viewState, viewportSize, targetZoom),
    [
      viewState.longitude, viewState.latitude, viewState.zoom,
      viewState.pitch, viewState.bearing,
      viewportSize.width, viewportSize.height,
      targetZoom,
    ],
  );

  // Prune stale tiles after the viewport settles:
  // - tiles that don't overlap the viewport at all
  // - tiles more than 1 zoom level from targetZoom (no longer useful as fallback)
  useEffect(() => {
    const timer = setTimeout(() => {
      setTileMap((prev) => {
        let changed = false;
        const next: Record<string, RequestTile> = {};
        for (const [id, rec] of Object.entries(prev)) {
          const overlaps = tileOverlapsRange(rec.index, visibleRange);
          const nearTarget = Math.abs(rec.index.z - targetZoom) <= 1;
          if (rec.status === "loading" || (overlaps && nearTarget)) {
            next[id] = rec;
          } else {
            changed = true;
            if (rec.demTexture) disposalQueue.current.push(rec.demTexture);
            if (rec.imageryTexture) disposalQueue.current.push(rec.imageryTexture);
          }
        }
        return changed ? next : prev;
      });
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [visibleRange, targetZoom]);

  const readyTiles = useMemo(
    () => selectVisibleTiles(tileMap, targetZoom, visibleRange),
    [tileMap, targetZoom, visibleRange],
  );

  return {
    layer,
    readyTiles,
    decodeParams,
  };
}
