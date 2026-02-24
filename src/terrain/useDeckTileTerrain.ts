import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TileLayer } from "@deck.gl/geo-layers";
import * as THREE from "three";
import type { DemDecodeParams, TileIndex } from "../types";
import type { TileRecord, EdgeRecord, CornerPatchRecord } from "./types";

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

async function loadTileTextures(index: TileIndex): Promise<TileTextures> {
  const loader = new THREE.TextureLoader();
  const [demTexture, imageryTexture] = await Promise.all([
    loader.loadAsync(buildDemUrl(index)),
    loader.loadAsync(buildImageryUrl(index)),
  ]);

  demTexture.flipY = true;
  demTexture.colorSpace = THREE.NoColorSpace;
  demTexture.minFilter = THREE.LinearFilter;
  demTexture.magFilter = THREE.LinearFilter;
  demTexture.wrapS = THREE.ClampToEdgeWrapping;
  demTexture.wrapT = THREE.ClampToEdgeWrapping;

  imageryTexture.flipY = true;
  imageryTexture.colorSpace = THREE.SRGBColorSpace;
  imageryTexture.minFilter = THREE.LinearFilter;
  imageryTexture.magFilter = THREE.LinearFilter;
  imageryTexture.wrapS = THREE.ClampToEdgeWrapping;
  imageryTexture.wrapT = THREE.ClampToEdgeWrapping;

  return { demTexture, imageryTexture };
}

export function useDeckTileTerrain(
  decodeParams: DemDecodeParams,
  fixedZoom: number,
): {
  layer: TileLayer;
  tileRecords: TileRecord[];
  edgeRecords: EdgeRecord[];
  cornerRecords: CornerPatchRecord[];
  decodeParams: DemDecodeParams;
} {
  const [tileMap, setTileMap] = useState<Record<string, TileRecord>>({});
  const aliveIds = useRef(new Set<string>());
  const disposalQueue = useRef<THREE.Texture[]>([]);

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

  // Deferred texture disposal — flush after React has reconciled (meshes unmounted).
  useEffect(() => {
    if (!disposalQueue.current.length) return;
    const handle = requestAnimationFrame(() => {
      disposalQueue.current.splice(0).forEach((t) => t.dispose());
    });
    return () => cancelAnimationFrame(handle);
  });

  const layer = useMemo(
    () =>
      new TileLayer({
        id: "dem-imagery-loader",
        data: IMAGERY_ENDPOINT,
        tileSize: 256,
        minZoom: fixedZoom,
        maxZoom: fixedZoom,
        maxRequests: 16,
        debounceTime: 50,
        refinementStrategy: "no-overlap",
        renderSubLayers: () => null,
        getTileData: ({ index }: { index: TileIndex }) => loadTileTextures(index),
        onTileLoad,
        onTileUnload,
      }),
    [fixedZoom, onTileLoad, onTileUnload],
  );

  const { edgeRecords, cornerRecords } = useMemo(() => {
    const ready = Object.values(tileMap).filter((t) => t.status === "ready");
    const lookup = new Map(ready.map((t) => [t.id, t]));
    const edges: EdgeRecord[] = [];
    const corners: CornerPatchRecord[] = [];

    for (const tile of ready) {
      const { x, y, z } = tile.index;
      const eastId = `${z}/${x + 1}/${y}`;
      const southId = `${z}/${x}/${y + 1}`;
      const seId = `${z}/${x + 1}/${y + 1}`;

      const east = lookup.get(eastId);
      const south = lookup.get(southId);
      const se = lookup.get(seId);

      if (east)
        edges.push({ id: `edge-east-${tile.id}`, direction: "east", tileA: tile, tileB: east });
      if (south)
        edges.push({ id: `edge-south-${tile.id}`, direction: "south", tileA: tile, tileB: south });
      if (east && south && se)
        corners.push({ id: `corner-${tile.id}`, nw: tile, ne: east, sw: south, se });
    }
    return { edgeRecords: edges, cornerRecords: corners };
  }, [tileMap]);

  return {
    layer,
    tileRecords: Object.values(tileMap),
    edgeRecords,
    cornerRecords,
    decodeParams,
  };
}
