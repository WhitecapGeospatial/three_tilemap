import { useCallback, useMemo, useRef, useState } from "react";
import { TileLayer } from "@deck.gl/geo-layers";
import * as THREE from "three";
import type { DemDecodeParams, TileIndex } from "../types";
import type { TileRecord } from "./types";

const DEM_ENDPOINT =
  "https://cogserver-staging-myzvqet7ua-uw.a.run.app/get_rgb_tile/{z}/{x}/{y}.png?dataset=GlobalTopoBath.tif";
  // "https://api.maptiler.com/tiles/ocean-rgb/{z}/{x}/{y}.webp?key=iN7qgGinNxGHRLUk5Apg&mtsid=07f4a282-f31e-4612-9b51-2ac93f9589e6";
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
type UseDeckTileTerrainOptions = {
  dropAncestorsOnLoad?: boolean;
  dropDescendantsOnLoad?: boolean;
};
type DeckTileNode = {
  index: TileIndex;
  data?: TileTextures;
  parent?: DeckTileNode | null;
  children?: DeckTileNode[] | null;
  isVisible?: boolean;
  isSelected?: boolean;
};

async function loadTileTextures(index: TileIndex): Promise<TileTextures> {
  const loader = new THREE.TextureLoader();
  const [demTexture, imageryTexture] = await Promise.all([
    loader.loadAsync(buildDemUrl(index)),
    loader.loadAsync(buildImageryUrl(index)),
  ]);

  // Raw data texture — no colour-space conversion so RGB byte values are
  // preserved exactly for elevation decoding in the vertex shader.
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

function isAncestorTile(ancestor: TileIndex, candidate: TileIndex): boolean {
  if (ancestor.z >= candidate.z) return false;
  const dz = candidate.z - ancestor.z;
  return (candidate.x >> dz) === ancestor.x && (candidate.y >> dz) === ancestor.y;
}

function isSameTile(a: TileIndex, b: TileIndex): boolean {
  return a.z === b.z && a.x === b.x && a.y === b.y;
}

function visibleImmediateChildIds(parent: DeckTileNode | undefined): string[] {
  if (!parent?.children?.length) return [];

  const immediateChildren = parent.children.filter(
    (child) => child.index.z === parent.index.z + 1,
  );
  if (!immediateChildren.length) return [];

  const hasVisibilityHints = immediateChildren.some(
    (child) =>
      typeof child.isVisible === "boolean" ||
      typeof child.isSelected === "boolean",
  );

  return immediateChildren
    .filter((child) =>
      hasVisibilityHints ? Boolean(child.isVisible || child.isSelected) : true,
    )
    .map((child) => tileId(child.index));
}

export function useDeckTileTerrain(
  decodeParams: DemDecodeParams,
  options?: UseDeckTileTerrainOptions,
): {
  layer: TileLayer;
  tileRecords: TileRecord[];
  decodeParams: DemDecodeParams;
} {
  const { dropAncestorsOnLoad = true, dropDescendantsOnLoad = true } = options ?? {};
  const [tileMap, setTileMap] = useState<Record<string, TileRecord>>({});
  const aliveIds = useRef(new Set<string>());

  const onTileUnload = useCallback((tile: { index: TileIndex }) => {
    const id = tileId(tile.index);
    aliveIds.current.delete(id);

    // Don't dispose GPU resources here — TileTerrainMesh owns them and will
    // dispose in its own cleanup effect after it has been removed from the
    // Three scene graph.  Disposing here while the mesh is still mounted
    // causes "Invalid value used as weak map key" in Three's WebGPU backend.
    setTileMap((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const onTileLoad = useCallback(
    (tile: DeckTileNode) => {
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

        for (const [existingId, existing] of Object.entries(next)) {
          if (existingId === id) continue;

          if (dropAncestorsOnLoad && isAncestorTile(existing.index, tile.index)) {
            const incomingParent = tile.parent;
            const isIncomingDirectParent =
              incomingParent && isSameTile(existing.index, incomingParent.index);

            if (isIncomingDirectParent) {
              const requiredVisibleChildIds = visibleImmediateChildIds(incomingParent);
              const missingVisibleChildren = requiredVisibleChildIds.some(
                (childId) => !next[childId],
              );

              // Keep parent as fallback until every visible direct child is ready.
              if (missingVisibleChildren) continue;
            }

            delete next[existingId];
            continue;
          }

          if (dropDescendantsOnLoad && isAncestorTile(tile.index, existing.index)) {
            delete next[existingId];
          }
        }

        return next;
      });
    },
    [dropAncestorsOnLoad, dropDescendantsOnLoad],
  );

  const layer = useMemo(
    () =>
      new TileLayer({
        id: "dem-imagery-loader",
        data: IMAGERY_ENDPOINT,
        tileSize: 256,
        minZoom: 0,
        maxZoom: 14,
        maxRequests: 16,
        debounceTime: 50,
        refinementStrategy: "best-available",
        renderSubLayers: () => null,
        getTileData: ({ index }: { index: TileIndex }) => loadTileTextures(index),
        onTileLoad,
        onTileUnload,
      }),
    [onTileLoad, onTileUnload],
  );

  return {
    layer,
    tileRecords: Object.values(tileMap),
    decodeParams,
  };
}
