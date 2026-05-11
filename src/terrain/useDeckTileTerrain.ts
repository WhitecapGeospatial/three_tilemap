import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TileLayer } from "@deck.gl/geo-layers";
import * as THREE from "three";
import type { DemDecodeParams, TileIndex } from "../types";
import type { RequestTile } from "./types";

const DEM_ENDPOINT =
  "https://cogserver-staging-myzvqet7ua-uw.a.run.app/get_rgb_tile/{z}/{x}/{y}.png?dataset=GlobalTopoBath.tif";
const IMAGERY_ENDPOINT =
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

function tileId(index: TileIndex): string {
  return `${index.z}/${index.x}/${index.y}`;
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

function loadTileTextures(index: TileIndex): Promise<TileTextures> {
  const id = tileId(index);
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
  maxRenderZoom: number,
  requestGeneration: number,
): {
  layer: TileLayer;
  requestTileCache: Map<string, RequestTile>;
  decodeParams: DemDecodeParams;
  pruneUnusedTiles: (referencedIds: Set<string>) => void;
  fetchTiles: (indices: TileIndex[]) => void;
} {
  const [tileMap, setTileMap] = useState<Record<string, RequestTile>>({});
  const aliveIds = useRef(new Set<string>());
  const disposalQueue = useRef<THREE.Texture[]>([]);
  const setTileMapRef = useRef(setTileMap);
  setTileMapRef.current = setTileMap;

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

      setTileMap((prev) => {
        const next = { ...prev };
        next[id] = {
          id,
          index: tile.index,
          status: "ready",
          imageryTexture,
          demTexture,
          lastUsed: performance.now(),
        };
        return next;
      });
    },
    [],
  );

  const onTileError = useCallback(
    (_error: unknown, tile: { index: TileIndex }) => {
      const id = tileId(tile.index);
      setTileMap((prev) => {
        const next = { ...prev };
        next[id] = {
          id,
          index: tile.index,
          status: "error",
          errorMessage: _error instanceof Error ? _error.message : String(_error),
          lastUsed: performance.now(),
        };
        return next;
      });
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

  const getTileData = useCallback(
    ({ index }: { index: TileIndex }) => {
      const id = tileId(index);
      setTileMapRef.current((prev) => {
        if (prev[id]?.status === "ready") return prev;
        return {
          ...prev,
          [id]: {
            id,
            index,
            status: "loading" as const,
            lastUsed: performance.now(),
          },
        };
      });
      return loadTileTextures(index);
    },
    [],
  );

  const layer = useMemo(
    () =>
      new TileLayer({
        id: `dem-imagery-loader-${requestGeneration}`,
        data: IMAGERY_ENDPOINT,
        tileSize: 256,
        minZoom: minRequestZoom,
        maxZoom: maxRenderZoom,
        maxRequests: 16,
        debounceTime: 50,
        refinementStrategy: "best-available",
        renderSubLayers: () => null,
        getTileData,
        onTileLoad,
        onTileUnload,
        onTileError,
      }),
    [minRequestZoom, maxRenderZoom, requestGeneration, getTileData, onTileLoad, onTileUnload, onTileError],
  );

  const requestTileCache = useMemo(() => {
    const cache = new Map<string, RequestTile>();
    for (const rec of Object.values(tileMap)) {
      cache.set(rec.id, rec);
    }
    return cache;
  }, [tileMap]);

  const pruneUnusedTiles = useCallback((referencedIds: Set<string>) => {
    setTileMap((prev) => {
      let changed = false;
      const next: Record<string, RequestTile> = {};
      for (const [id, rec] of Object.entries(prev)) {
        if (referencedIds.has(id)) {
          next[id] = rec;
        } else {
          changed = true;
          if (rec.demTexture) disposalQueue.current.push(rec.demTexture);
          if (rec.imageryTexture) disposalQueue.current.push(rec.imageryTexture);
        }
      }
      return changed ? next : prev;
    });
  }, []);

  const fetchTiles = useCallback((indices: TileIndex[]) => {
    for (const index of indices) {
      const id = tileId(index);
      const existing = requestTileCache.get(id);
      if (existing?.status === "ready" || existing?.status === "loading") continue;

      setTileMapRef.current((prev) => {
        if (prev[id]?.status === "ready" || prev[id]?.status === "loading") return prev;
        return {
          ...prev,
          [id]: { id, index, status: "loading" as const, lastUsed: performance.now() },
        };
      });

      loadTileTextures(index).then(({ demTexture, imageryTexture }) => {
        setTileMapRef.current((prev) => ({
          ...prev,
          [id]: { id, index, status: "ready" as const, demTexture, imageryTexture, lastUsed: performance.now() },
        }));
      }).catch((err) => {
        setTileMapRef.current((prev) => ({
          ...prev,
          [id]: { id, index, status: "error" as const, errorMessage: String(err), lastUsed: performance.now() },
        }));
      });
    }
  }, [requestTileCache]);

  return {
    layer,
    requestTileCache,
    decodeParams,
    pruneUnusedTiles,
    fetchTiles,
  };
}
