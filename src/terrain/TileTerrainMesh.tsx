import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import * as ThreeWebGPU from "three/webgpu";
import { texture, uniform, vec3, float, positionLocal, uv } from "three/tsl";
import type { DemDecodeParams, MapViewState, TileSize } from "../types";
import type { RequestTile } from "./types";
import { metersToWorldScale, tileToWorldBounds } from "../utils/tileMath";
import type { DebugVisState } from "../debugVis";

const SEGMENTS = 16;

type TileTerrainMeshProps = {
  tile: RequestTile;
  viewState: MapViewState | { longitude: number; latitude: number };
  viewportSize: TileSize;
  heightScale: number;
  debug: DebugVisState;
  decodeParams: DemDecodeParams;
  meterZoom?: number;
  isSelected?: boolean;
  onSelect?: (tileId: string) => void;
};

const HIGHLIGHT_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0x00ffff,
  opacity: 0.25,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
});

export function TileTerrainMesh({ tile, viewState, viewportSize, heightScale, debug, decodeParams, meterZoom, isSelected, onSelect }: TileTerrainMeshProps) {
  const hasLoggedRef = useRef(false);

  const worldBounds = useMemo(
    () => tileToWorldBounds(viewState, viewportSize, tile.index, meterZoom),
    [tile.index.x, tile.index.y, tile.index.z, viewState, viewportSize, meterZoom],
  );
  const worldUnitsPerMeter = useMemo(
    () => metersToWorldScale(viewState, viewportSize, meterZoom),
    [viewState, viewportSize, meterZoom],
  );

  const geometry = useMemo(() => {
    const width = worldBounds.worldMaxX - worldBounds.worldMinX;
    const height = worldBounds.worldMaxY - worldBounds.worldMinY;
    return new THREE.PlaneGeometry(width, height, SEGMENTS, SEGMENTS);
  }, [worldBounds.worldMaxX, worldBounds.worldMaxY, worldBounds.worldMinX, worldBounds.worldMinY]);

  const nodes = useMemo(() => {
    const demTexNode = texture(tile.demTexture!, uv());
    const imgTexNode = texture(tile.imageryTexture!, uv());
    const uBase = uniform(decodeParams.base);
    const uInterval = uniform(decodeParams.interval);
    const uHeightScaleFactor = uniform(heightScale * debug.displacementScale * worldUnitsPerMeter);
    const uFlattenTerrain = uniform(debug.flattenTerrain ? 1.0 : 0.0);
    const uWireframeWhite = uniform(debug.wireframe ? 1.0 : 0.0);
    return { demTexNode, imgTexNode, uBase, uInterval, uHeightScaleFactor, uFlattenTerrain, uWireframeWhite };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tile.demTexture, tile.imageryTexture]);

  const material = useMemo(() => {
    const { demTexNode, imgTexNode, uBase, uInterval, uHeightScaleFactor, uFlattenTerrain, uWireframeWhite } = nodes;

    const elevation = uBase.add(
      demTexNode.r.mul(255.0 * 65536.0)
        .add(demTexNode.g.mul(255.0 * 256.0))
        .add(demTexNode.b.mul(255.0))
        .mul(uInterval),
    );

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

  useEffect(() => {
    return () => { geometry?.dispose(); };
  }, [geometry]);

  useEffect(() => {
    return () => { material.dispose(); };
  }, [material]);

  useEffect(() => {
    if (!geometry || hasLoggedRef.current || !debug.logTileBounds) return;

    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;
    hasLoggedRef.current = true;
    console.info("[tile-bounds]", {
      id: tile.id,
      index: tile.index,
      worldBounds,
      worldUnitsPerMeter,
      meshZRange: bounds ? { min: bounds.min.z, max: bounds.max.z } : null,
    });
  }, [geometry, tile.id, tile.index, worldBounds, worldUnitsPerMeter, debug.logTileBounds]);

  if (!tile.demTexture || !tile.imageryTexture) {
    return null;
  }

  const handleClick = useMemo(() => {
    if (!onSelect) return undefined;
    return (e: { stopPropagation: () => void }) => {
      e.stopPropagation();
      onSelect(tile.id);
    };
  }, [onSelect, tile.id]);

  return (
    <group position={[worldBounds.centerX, worldBounds.centerY, 0]}>
      <mesh geometry={geometry} frustumCulled={false} onClick={handleClick}>
        <primitive object={material} attach="material" />
      </mesh>
      {isSelected && (
        <mesh geometry={geometry} frustumCulled={false} position={[0, 0, 0.001]}>
          <primitive object={HIGHLIGHT_MATERIAL} attach="material" />
        </mesh>
      )}
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
