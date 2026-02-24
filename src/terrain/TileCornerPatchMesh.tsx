import { useEffect, useMemo } from "react";
import * as THREE from "three";
import * as ThreeWebGPU from "three/webgpu";
import { texture, uniform, vec3, vec2, float, positionLocal, uv, mix, step } from "three/tsl";
import type { DemDecodeParams, MapViewState, TileSize } from "../types";
import type { CornerPatchRecord } from "./types";
import { metersToWorldScale, tileToWorldBounds } from "../utils/tileMath";
import type { DebugVisState } from "../debugVis";

const SEGMENTS = 32;

type TileCornerPatchMeshProps = {
  corner: CornerPatchRecord;
  viewState: MapViewState | { longitude: number; latitude: number };
  viewportSize: TileSize;
  heightScale: number;
  debug: DebugVisState;
  decodeParams: DemDecodeParams;
  zoomOverride?: number;
  uvInset: number;
};

export function TileCornerPatchMesh({ corner, viewState, viewportSize, heightScale, debug, decodeParams, zoomOverride, uvInset }: TileCornerPatchMeshProps) {
  const boundsNW = useMemo(
    () => tileToWorldBounds(viewState, viewportSize, corner.nw.index, zoomOverride),
    [corner.nw.index, viewState, viewportSize, zoomOverride],
  );
  const boundsNE = useMemo(
    () => tileToWorldBounds(viewState, viewportSize, corner.ne.index, zoomOverride),
    [corner.ne.index, viewState, viewportSize, zoomOverride],
  );
  const boundsSW = useMemo(
    () => tileToWorldBounds(viewState, viewportSize, corner.sw.index, zoomOverride),
    [corner.sw.index, viewState, viewportSize, zoomOverride],
  );

  const worldUnitsPerMeter = useMemo(
    () => metersToWorldScale(viewState, viewportSize, zoomOverride),
    [viewState, viewportSize, zoomOverride],
  );

  const { patchWidth, patchHeight, centerX, centerY } = useMemo(() => {
    const tileW_NW = boundsNW.worldMaxX - boundsNW.worldMinX;
    const tileH_NW = boundsNW.worldMaxY - boundsNW.worldMinY;
    const tileW_NE = boundsNE.worldMaxX - boundsNE.worldMinX;
    const tileH_SW = boundsSW.worldMaxY - boundsSW.worldMinY;

    return {
      patchWidth: uvInset * (tileW_NW + tileW_NE),
      patchHeight: uvInset * (tileH_NW + tileH_SW),
      centerX: boundsNW.worldMaxX,
      centerY: boundsNW.worldMinY,
    };
  }, [boundsNW, boundsNE, boundsSW, uvInset]);

  const geometry = useMemo(() => {
    return new THREE.PlaneGeometry(patchWidth, patchHeight, SEGMENTS, SEGMENTS);
  }, [patchWidth, patchHeight]);

  const nodes = useMemo(() => {
    const demNW = corner.nw.demTexture!;
    const demNE = corner.ne.demTexture!;
    const demSW = corner.sw.demTexture!;
    const demSE = corner.se.demTexture!;
    const imgNW = corner.nw.imageryTexture!;
    const imgNE = corner.ne.imageryTexture!;
    const imgSW = corner.sw.imageryTexture!;
    const imgSE = corner.se.imageryTexture!;

    const inset2 = float(2.0 * uvInset);
    const oneMinusInset = float(1 - uvInset);

    const tx = step(float(0.5), uv().x);
    const ty = step(float(0.5), uv().y);

    // West column X: u [0, 0.5] -> tileUV_x [1-inset, 1.0]
    const westX = uv().x.mul(inset2).add(oneMinusInset);
    // East column X: u [0.5, 1.0] -> tileUV_x [0.0, inset]
    const eastX = uv().x.sub(0.5).mul(inset2);

    // Bottom row Y: v [0, 0.5] -> tileUV_y [1-inset, 1.0] (north buffer of south tiles)
    const bottomY = uv().y.mul(inset2).add(oneMinusInset);
    // Top row Y: v [0.5, 1.0] -> tileUV_y [0.0, inset] (south buffer of north tiles)
    const topY = uv().y.sub(0.5).mul(inset2);

    const uvSW = vec2(westX, bottomY);
    const uvSE = vec2(eastX, bottomY);
    const uvNW = vec2(westX, topY);
    const uvNE = vec2(eastX, topY);

    const demTexNode = mix(
      mix(texture(demSW, uvSW), texture(demSE, uvSE), tx),
      mix(texture(demNW, uvNW), texture(demNE, uvNE), tx),
      ty,
    );
    const imgTexNode = mix(
      mix(texture(imgSW, uvSW), texture(imgSE, uvSE), tx),
      mix(texture(imgNW, uvNW), texture(imgNE, uvNE), tx),
      ty,
    );

    const uBase = uniform(decodeParams.base);
    const uInterval = uniform(decodeParams.interval);
    const uHeightScaleFactor = uniform(heightScale * debug.displacementScale * worldUnitsPerMeter);
    const uFlattenTerrain = uniform(debug.flattenTerrain ? 1.0 : 0.0);
    const uWireframeWhite = uniform(debug.wireframe ? 1.0 : 0.0);

    return { demTexNode, imgTexNode, uBase, uInterval, uHeightScaleFactor, uFlattenTerrain, uWireframeWhite };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    corner.nw.demTexture, corner.nw.imageryTexture,
    corner.ne.demTexture, corner.ne.imageryTexture,
    corner.sw.demTexture, corner.sw.imageryTexture,
    corner.se.demTexture, corner.se.imageryTexture,
    uvInset,
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

  const allReady =
    corner.nw.demTexture && corner.nw.imageryTexture &&
    corner.ne.demTexture && corner.ne.imageryTexture &&
    corner.sw.demTexture && corner.sw.imageryTexture &&
    corner.se.demTexture && corner.se.imageryTexture;

  if (!allReady) return null;

  return (
    <group position={[centerX, centerY, 0]}>
      <mesh geometry={geometry} frustumCulled={false}>
        <primitive object={material} attach="material" />
      </mesh>
    </group>
  );
}
