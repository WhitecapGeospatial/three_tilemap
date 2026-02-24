import { useEffect, useMemo } from "react";
import * as THREE from "three";
import * as ThreeWebGPU from "three/webgpu";
import { texture, uniform, vec3, vec2, float, positionLocal, uv, mix, step } from "three/tsl";
import type { DemDecodeParams, MapViewState, TileSize } from "../types";
import type { EdgeRecord } from "./types";
import { metersToWorldScale, tileToWorldBounds } from "../utils/tileMath";
import type { DebugVisState } from "../debugVis";

const SEGMENTS = 32;

type TileEdgeStripMeshProps = {
  edge: EdgeRecord;
  viewState: MapViewState | { longitude: number; latitude: number };
  viewportSize: TileSize;
  heightScale: number;
  debug: DebugVisState;
  decodeParams: DemDecodeParams;
  zoomOverride?: number;
  uvInset: number;
};

export function TileEdgeStripMesh({ edge, viewState, viewportSize, heightScale, debug, decodeParams, zoomOverride, uvInset }: TileEdgeStripMeshProps) {
  const boundsA = useMemo(
    () => tileToWorldBounds(viewState, viewportSize, edge.tileA.index, zoomOverride),
    [edge.tileA.index, viewState, viewportSize, zoomOverride],
  );
  const boundsB = useMemo(
    () => tileToWorldBounds(viewState, viewportSize, edge.tileB.index, zoomOverride),
    [edge.tileB.index, viewState, viewportSize, zoomOverride],
  );
  const worldUnitsPerMeter = useMemo(
    () => metersToWorldScale(viewState, viewportSize, zoomOverride),
    [viewState, viewportSize, zoomOverride],
  );

  const { stripWidth, stripHeight, centerX, centerY } = useMemo(() => {
    const tileW_A = boundsA.worldMaxX - boundsA.worldMinX;
    const tileH_A = boundsA.worldMaxY - boundsA.worldMinY;
    const tileW_B = boundsB.worldMaxX - boundsB.worldMinX;
    const tileH_B = boundsB.worldMaxY - boundsB.worldMinY;

    if (edge.direction === "east") {
      return {
        stripWidth: uvInset * (tileW_A + tileW_B),
        stripHeight: tileH_A * (1 - 2 * uvInset),
        centerX: boundsA.worldMaxX,
        centerY: boundsA.centerY,
      };
    }
    // south
    return {
      stripWidth: tileW_A * (1 - 2 * uvInset),
      stripHeight: uvInset * (tileH_A + tileH_B),
      centerX: boundsA.centerX,
      centerY: boundsA.worldMinY,
    };
  }, [boundsA, boundsB, edge.direction, uvInset]);

  const geometry = useMemo(() => {
    return new THREE.PlaneGeometry(stripWidth, stripHeight, SEGMENTS, SEGMENTS);
  }, [stripWidth, stripHeight]);

  const nodes = useMemo(() => {
    const demA = edge.tileA.demTexture!;
    const demB = edge.tileB.demTexture!;
    const imgA = edge.tileA.imageryTexture!;
    const imgB = edge.tileB.imageryTexture!;

    const insetF = float(uvInset);
    const coreRange = float(1 - 2 * uvInset);

    let demTexNode;
    let imgTexNode;

    if (edge.direction === "east") {
      const t = step(float(0.5), uv().x);
      // v axis: same inset as core
      const vy = uv().y.mul(coreRange).add(insetF);
      // tile A: u [0, 0.5] -> UV_x [1-uvInset, 1.0]
      const uvA = vec2(uv().x.mul(float(2.0 * uvInset)).add(float(1 - uvInset)), vy);
      // tile B: u [0.5, 1.0] -> UV_x [0.0, uvInset]
      const uvB = vec2(uv().x.sub(0.5).mul(float(2.0 * uvInset)), vy);

      demTexNode = mix(texture(demA, uvA), texture(demB, uvB), t);
      imgTexNode = mix(texture(imgA, uvA), texture(imgB, uvB), t);
    } else {
      // south: v is the bridging direction
      const t = step(float(0.5), uv().y);
      // u axis: same inset as core
      const vx = uv().x.mul(coreRange).add(insetF);
      // tile B (south, bottom half): v [0, 0.5] -> UV_y [1-uvInset, 1.0]
      const uvB = vec2(vx, uv().y.mul(float(2.0 * uvInset)).add(float(1 - uvInset)));
      // tile A (north, top half): v [0.5, 1.0] -> UV_y [0.0, uvInset]
      const uvA = vec2(vx, uv().y.sub(0.5).mul(float(2.0 * uvInset)));

      demTexNode = mix(texture(demB, uvB), texture(demA, uvA), t);
      imgTexNode = mix(texture(imgB, uvB), texture(imgA, uvA), t);
    }

    const uBase = uniform(decodeParams.base);
    const uInterval = uniform(decodeParams.interval);
    const uHeightScaleFactor = uniform(heightScale * debug.displacementScale * worldUnitsPerMeter);
    const uFlattenTerrain = uniform(debug.flattenTerrain ? 1.0 : 0.0);
    const uWireframeWhite = uniform(debug.wireframe ? 1.0 : 0.0);

    return { demTexNode, imgTexNode, uBase, uInterval, uHeightScaleFactor, uFlattenTerrain, uWireframeWhite };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    edge.tileA.demTexture, edge.tileA.imageryTexture,
    edge.tileB.demTexture, edge.tileB.imageryTexture,
    edge.direction, uvInset,
  ]);

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

  if (!edge.tileA.demTexture || !edge.tileA.imageryTexture ||
      !edge.tileB.demTexture || !edge.tileB.imageryTexture) {
    return null;
  }

  return (
    <group position={[centerX, centerY, 0]}>
      <mesh geometry={geometry} frustumCulled={false}>
        <primitive object={material} attach="material" />
      </mesh>
    </group>
  );
}
