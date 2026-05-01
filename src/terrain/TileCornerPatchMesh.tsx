import { useEffect, useMemo } from "react";
import * as THREE from "three";
import * as ThreeWebGPU from "three/webgpu";
import { texture, uniform, vec3, vec2, float, positionLocal, uv, mix, step } from "three/tsl";
import type { DemDecodeParams, MapViewState, TileIndex, TileSize } from "../types";
import type { RenderedCornerRecord } from "./types";
import { metersToWorldScale, tileToWorldBounds } from "../utils/tileMath";
import type { DebugVisState } from "../debugVis";

type TileCornerPatchMeshProps = {
  corner: RenderedCornerRecord;
  maxRenderZoom: number;
  viewState: MapViewState | { longitude: number; latitude: number };
  viewportSize: TileSize;
  heightScale: number;
  debug: DebugVisState;
  decodeParams: DemDecodeParams;
  meterZoom?: number;
  uvInset: number;
};

export function TileCornerPatchMesh({ corner, maxRenderZoom, viewState, viewportSize, heightScale, debug, decodeParams, meterZoom, uvInset }: TileCornerPatchMeshProps) {
  const riNW: TileIndex = { x: corner.nw.renderIndex.x, y: corner.nw.renderIndex.y, z: maxRenderZoom };
  const riNE: TileIndex = { x: corner.ne.renderIndex.x, y: corner.ne.renderIndex.y, z: maxRenderZoom };
  const riSW: TileIndex = { x: corner.sw.renderIndex.x, y: corner.sw.renderIndex.y, z: maxRenderZoom };

  const boundsNW = useMemo(
    () => tileToWorldBounds(viewState, viewportSize, riNW, meterZoom),
    [riNW.x, riNW.y, riNW.z, viewState, viewportSize, meterZoom],
  );
  const boundsNE = useMemo(
    () => tileToWorldBounds(viewState, viewportSize, riNE, meterZoom),
    [riNE.x, riNE.y, riNE.z, viewState, viewportSize, meterZoom],
  );
  const boundsSW = useMemo(
    () => tileToWorldBounds(viewState, viewportSize, riSW, meterZoom),
    [riSW.x, riSW.y, riSW.z, viewState, viewportSize, meterZoom],
  );
  const worldUnitsPerMeter = useMemo(
    () => metersToWorldScale(viewState, viewportSize, meterZoom),
    [viewState, viewportSize, meterZoom],
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
    return new THREE.PlaneGeometry(patchWidth, patchHeight, corner.segments, corner.segments);
  }, [patchWidth, patchHeight, corner.segments]);

  const uvbNW = corner.nw.source.uvBounds;
  const uvbNE = corner.ne.source.uvBounds;
  const uvbSW = corner.sw.source.uvBounds;
  const uvbSE = corner.se.source.uvBounds;

  const nodes = useMemo(() => {
    const demNW = corner.nw.source.requestTile.demTexture!;
    const demNE = corner.ne.source.requestTile.demTexture!;
    const demSW = corner.sw.source.requestTile.demTexture!;
    const demSE = corner.se.source.requestTile.demTexture!;
    const imgNW = corner.nw.source.requestTile.imageryTexture!;
    const imgNE = corner.ne.source.requestTile.imageryTexture!;
    const imgSW = corner.sw.source.requestTile.imageryTexture!;
    const imgSE = corner.se.source.requestTile.imageryTexture!;

    const insetF = float(uvInset);
    const oneMinusInset = float(1 - uvInset);
    const inset2 = float(2.0 * uvInset);

    const tx = step(float(0.5), uv().x);
    const ty = step(float(0.5), uv().y);

    const westXnorm = uv().x.mul(inset2).add(oneMinusInset);
    const eastXnorm = uv().x.sub(0.5).mul(inset2);
    const bottomYnorm = uv().y.mul(inset2).add(oneMinusInset);
    const topYnorm = uv().y.sub(0.5).mul(inset2);

    function remap(uvb: typeof uvbNW, xNorm: ReturnType<typeof float>, yNorm: ReturnType<typeof float>) {
      const mn = vec2(float(uvb.uMin), float(uvb.vMin));
      const sz = vec2(float(uvb.uMax - uvb.uMin), float(uvb.vMax - uvb.vMin));
      return mn.add(vec2(sz.x.mul(xNorm), sz.y.mul(yNorm)));
    }

    const uvSW = remap(uvbSW, westXnorm, bottomYnorm);
    const uvSE = remap(uvbSE, eastXnorm, bottomYnorm);
    const uvNW = remap(uvbNW, westXnorm, topYnorm);
    const uvNE = remap(uvbNE, eastXnorm, topYnorm);

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
    corner.nw.source.requestTile.demTexture, corner.nw.source.requestTile.imageryTexture,
    corner.ne.source.requestTile.demTexture, corner.ne.source.requestTile.imageryTexture,
    corner.sw.source.requestTile.demTexture, corner.sw.source.requestTile.imageryTexture,
    corner.se.source.requestTile.demTexture, corner.se.source.requestTile.imageryTexture,
    uvbNW.uMin, uvbNW.vMin, uvbNW.uMax, uvbNW.vMax,
    uvbNE.uMin, uvbNE.vMin, uvbNE.uMax, uvbNE.vMax,
    uvbSW.uMin, uvbSW.vMin, uvbSW.uMax, uvbSW.vMax,
    uvbSE.uMin, uvbSE.vMin, uvbSE.uMax, uvbSE.vMax,
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

  useEffect(() => { material.wireframe = debug.wireframe; }, [material, debug.wireframe]);
  useEffect(() => { nodes.uWireframeWhite.value = debug.wireframe ? 1.0 : 0.0; }, [nodes, debug.wireframe]);
  useEffect(() => { nodes.uHeightScaleFactor.value = heightScale * debug.displacementScale * worldUnitsPerMeter; }, [nodes, heightScale, debug.displacementScale, worldUnitsPerMeter]);
  useEffect(() => { nodes.uFlattenTerrain.value = debug.flattenTerrain ? 1.0 : 0.0; }, [nodes, debug.flattenTerrain]);
  useEffect(() => { nodes.uBase.value = decodeParams.base; nodes.uInterval.value = decodeParams.interval; }, [nodes, decodeParams]);
  useEffect(() => { return () => { geometry?.dispose(); }; }, [geometry]);
  useEffect(() => { return () => { material.dispose(); }; }, [material]);

  const allReady =
    corner.nw.source.requestTile.demTexture && corner.nw.source.requestTile.imageryTexture &&
    corner.ne.source.requestTile.demTexture && corner.ne.source.requestTile.imageryTexture &&
    corner.sw.source.requestTile.demTexture && corner.sw.source.requestTile.imageryTexture &&
    corner.se.source.requestTile.demTexture && corner.se.source.requestTile.imageryTexture;

  if (!allReady) return null;

  return (
    <group position={[centerX, centerY, 0]}>
      <mesh geometry={geometry} frustumCulled={false}>
        <primitive object={material} attach="material" />
      </mesh>
    </group>
  );
}
