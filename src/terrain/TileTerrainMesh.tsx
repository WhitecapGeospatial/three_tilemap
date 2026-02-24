import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import * as ThreeWebGPU from "three/webgpu";
import { texture, uniform, vec3, float, positionLocal } from "three/tsl";
import type { DemDecodeParams, MapViewState, TileSize } from "../types";
import type { TileRecord } from "./types";
import { metersToWorldScale, tileToLngLatBounds, tileToWorldBounds } from "../utils/tileMath";
import type { DebugVisState } from "../debugVis";

type TileTerrainMeshProps = {
  tile: TileRecord;
  viewState: MapViewState | { longitude: number; latitude: number };
  viewportSize: TileSize;
  heightScale: number;
  debug: DebugVisState;
  decodeParams: DemDecodeParams;
  zoomOverride?: number;
};

function lodSegments(zoom: number): number {
  return 32
  if (zoom <= 6) return 32;
  if (zoom <= 10) return 64;
  return 128;
}

export function TileTerrainMesh({ tile, viewState, viewportSize, heightScale, debug, decodeParams, zoomOverride }: TileTerrainMeshProps) {
  const hasLoggedRef = useRef(false);
  const worldBounds = useMemo(
    () => tileToWorldBounds(viewState, viewportSize, tile.index, zoomOverride),
    [tile.index, viewState, viewportSize, zoomOverride],
  );
  const worldUnitsPerMeter = useMemo(
    () => metersToWorldScale(viewState, viewportSize, zoomOverride),
    [viewState, viewportSize, zoomOverride],
  );
  const lngLatBounds = useMemo(() => tileToLngLatBounds(tile.index), [tile.index]);

  // Flat PlaneGeometry — the vertex shader node handles Z displacement on the GPU.
  const geometry = useMemo(() => {
    const segments = lodSegments(tile.index.z);
    const width = worldBounds.worldMaxX - worldBounds.worldMinX;
    const height = worldBounds.worldMaxY - worldBounds.worldMinY;
    return new THREE.PlaneGeometry(width, height, segments, segments);
  }, [
    tile.index.z,
    worldBounds.worldMaxX,
    worldBounds.worldMaxY,
    worldBounds.worldMinX,
    worldBounds.worldMinY,
  ]);

  // Create TSL node objects keyed to texture identity.  These are stable
  // references — the compiled shader program stays alive; only the bound
  // values change when uniforms are updated via .value assignments below.
  const nodes = useMemo(() => {
    const demTexNode = texture(tile.demTexture!);
    const imgTexNode = texture(tile.imageryTexture!);
    const uBase = uniform(decodeParams.base);
    const uInterval = uniform(decodeParams.interval);
    const uHeightScaleFactor = uniform(heightScale * debug.displacementScale * worldUnitsPerMeter);
    // 0 = normal displacement, 1 = flatten to z=0
    const uFlattenTerrain = uniform(debug.flattenTerrain ? 1.0 : 0.0);
    // 0 = imagery color, 1 = force white (for wireframe visibility)
    const uWireframeWhite = uniform(debug.wireframe ? 1.0 : 0.0);
    return { demTexNode, imgTexNode, uBase, uInterval, uHeightScaleFactor, uFlattenTerrain, uWireframeWhite };
  // Recreate only when textures change (new tile). Scalar uniforms are kept
  // in sync via the effects below; one-frame lag for those is imperceptible.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tile.demTexture, tile.imageryTexture]);

  // Build the TSL node graph and material once per node set.
  const material = useMemo(() => {
    const { demTexNode, imgTexNode, uBase, uInterval, uHeightScaleFactor, uFlattenTerrain, uWireframeWhite } = nodes;

    // RGB terrain encoding: elevation = base + (R*256² + G*256 + B) * interval
    // Texture channels arrive as [0,1]; multiply by 255 to recover byte values.
    const elevation = uBase.add(
      demTexNode.r.mul(255.0 * 65536.0)
        .add(demTexNode.g.mul(255.0 * 256.0))
        .add(demTexNode.b.mul(255.0))
        .mul(uInterval),
    );

    // Multiply by (1 - uFlattenTerrain): when flatten=1 → z=0, when flatten=0 → full elevation.
    const z = elevation.mul(uHeightScaleFactor).mul(float(1.0).sub(uFlattenTerrain));
    const color = imgTexNode.rgb.mul(float(1.0).sub(uWireframeWhite)).add(vec3(1.0, 1.0, 1.0).mul(uWireframeWhite));

    const mat = new ThreeWebGPU.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    mat.positionNode = vec3(positionLocal.x, positionLocal.y, z);
    mat.colorNode = color;
    return mat;
  }, [nodes]);

  useEffect(() => {
    material.wireframe = debug.wireframe;
  }, [material, debug.wireframe]);

  useEffect(() => {
    nodes.uWireframeWhite.value = debug.wireframe ? 1.0 : 0.0;
  }, [nodes, debug.wireframe]);

  // Keep dynamic uniforms in sync (these mutate node .value, no shader recompile).
  useEffect(() => {
    nodes.uHeightScaleFactor.value = heightScale * debug.displacementScale * worldUnitsPerMeter;
  }, [nodes, heightScale, debug.displacementScale, worldUnitsPerMeter]);

  useEffect(() => {
    nodes.uFlattenTerrain.value = debug.flattenTerrain ? 1.0 : 0.0;
  }, [nodes, debug.flattenTerrain]);

  useEffect(() => {
    nodes.uBase.value = decodeParams.base;
    nodes.uInterval.value = decodeParams.interval;
  }, [nodes, decodeParams]);

  // ── GPU resource ownership ──────────────────────────────────────────────
  useEffect(() => {
    return () => {
      geometry?.dispose();
    };
  }, [geometry]);

  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  useEffect(() => {
    const img = tile.imageryTexture;
    const dem = tile.demTexture;
    return () => {
      img?.dispose();
      dem?.dispose();
    };
  }, [tile.imageryTexture, tile.demTexture]);

  // ── Debug logging ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!geometry || hasLoggedRef.current || !debug.logTileBounds) return;

    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;
    hasLoggedRef.current = true;
    console.info("[tile-bounds]", {
      id: tile.id,
      tileIndex: tile.index,
      lngLatBounds,
      worldBounds,
      worldUnitsPerMeter,
      meshZRange: bounds ? { min: bounds.min.z, max: bounds.max.z } : null,
    });
  }, [geometry, lngLatBounds, tile.id, tile.index, worldBounds, worldUnitsPerMeter, debug.logTileBounds]);

  if (!tile.demTexture || !tile.imageryTexture) {
    return null;
  }

  return (
    <group position={[worldBounds.centerX, worldBounds.centerY, 0]}>
      <mesh geometry={geometry} frustumCulled={false}>
        <primitive object={material} attach="material" />
      </mesh>
      {debug.showTileCorners ? (
        <>
          <mesh position={[worldBounds.worldMinX - worldBounds.centerX, worldBounds.worldMinY - worldBounds.centerY, 0]}>
            <sphereGeometry args={[0.008, 8, 8]} />
            <meshBasicMaterial color="#ff0000" />
          </mesh>
          <mesh position={[worldBounds.worldMaxX - worldBounds.centerX, worldBounds.worldMinY - worldBounds.centerY, 0]}>
            <sphereGeometry args={[0.008, 8, 8]} />
            <meshBasicMaterial color="#00ff00" />
          </mesh>
          <mesh position={[worldBounds.worldMaxX - worldBounds.centerX, worldBounds.worldMaxY - worldBounds.centerY, 0]}>
            <sphereGeometry args={[0.008, 8, 8]} />
            <meshBasicMaterial color="#0000ff" />
          </mesh>
          <mesh position={[worldBounds.worldMinX - worldBounds.centerX, worldBounds.worldMaxY - worldBounds.centerY, 0]}>
            <sphereGeometry args={[0.008, 8, 8]} />
            <meshBasicMaterial color="#ffff00" />
          </mesh>
        </>
      ) : null}
    </group>
  );
}
