import { useEffect, useMemo } from "react";
import * as THREE from "three";
import * as ThreeWebGPU from "three/webgpu";
import { texture, uniform, vec3, vec2, float, positionLocal, uv, mix, step } from "three/tsl";
import type { DemDecodeParams, MapViewState, TileIndex, TileSize } from "../types";
import type { RenderedEdgeRecord } from "./types";
import { metersToWorldScale, tileToWorldBounds } from "../utils/tileMath";
import type { DebugVisState } from "../debugVis";

type TileEdgeStripMeshProps = {
  edge: RenderedEdgeRecord;
  maxRenderZoom: number;
  viewState: MapViewState | { longitude: number; latitude: number };
  viewportSize: TileSize;
  heightScale: number;
  debug: DebugVisState;
  decodeParams: DemDecodeParams;
  meterZoom?: number;
  uvInset: number;
};

export function TileEdgeStripMesh({ edge, maxRenderZoom, viewState, viewportSize, heightScale, debug, decodeParams, meterZoom, uvInset }: TileEdgeStripMeshProps) {
  const renderIndexA: TileIndex = { x: edge.tileA.renderIndex.x, y: edge.tileA.renderIndex.y, z: maxRenderZoom };
  const renderIndexB: TileIndex = { x: edge.tileB.renderIndex.x, y: edge.tileB.renderIndex.y, z: maxRenderZoom };

  const boundsA = useMemo(
    () => tileToWorldBounds(viewState, viewportSize, renderIndexA, meterZoom),
    [renderIndexA.x, renderIndexA.y, renderIndexA.z, viewState, viewportSize, meterZoom],
  );
  const boundsB = useMemo(
    () => tileToWorldBounds(viewState, viewportSize, renderIndexB, meterZoom),
    [renderIndexB.x, renderIndexB.y, renderIndexB.z, viewState, viewportSize, meterZoom],
  );
  const worldUnitsPerMeter = useMemo(
    () => metersToWorldScale(viewState, viewportSize, meterZoom),
    [viewState, viewportSize, meterZoom],
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
    return {
      stripWidth: tileW_A * (1 - 2 * uvInset),
      stripHeight: uvInset * (tileH_A + tileH_B),
      centerX: boundsA.centerX,
      centerY: boundsA.worldMinY,
    };
  }, [boundsA, boundsB, edge.direction, uvInset]);

  const geometry = useMemo(() => {
    return new THREE.PlaneGeometry(stripWidth, stripHeight, edge.segments, edge.segments);
  }, [stripWidth, stripHeight, edge.segments]);

  const uvBoundsA = edge.tileA.source.uvBounds;
  const uvBoundsB = edge.tileB.source.uvBounds;

  const nodes = useMemo(() => {
    const demA = edge.tileA.source.requestTile.demTexture!;
    const demB = edge.tileB.source.requestTile.demTexture!;
    const imgA = edge.tileA.source.requestTile.imageryTexture!;
    const imgB = edge.tileB.source.requestTile.imageryTexture!;

    const uvMinA = vec2(float(uvBoundsA.uMin), float(uvBoundsA.vMin));
    const uvMaxA = vec2(float(uvBoundsA.uMax), float(uvBoundsA.vMax));
    const uvSizeA = uvMaxA.sub(uvMinA);

    const uvMinB = vec2(float(uvBoundsB.uMin), float(uvBoundsB.vMin));
    const uvMaxB = vec2(float(uvBoundsB.uMax), float(uvBoundsB.vMax));
    const uvSizeB = uvMaxB.sub(uvMinB);

    const insetF = float(uvInset);
    const coreSpan = float(1 - 2 * uvInset);

    let demTexNode;
    let imgTexNode;

    if (edge.direction === "east") {
      const t = step(float(0.5), uv().x);
      const vyNorm = uv().y.mul(coreSpan).add(insetF);

      const localAxNorm = uv().x.mul(float(2.0 * uvInset)).add(float(1 - uvInset));
      const uvA = uvMinA.add(vec2(uvSizeA.x.mul(localAxNorm), uvSizeA.y.mul(vyNorm)));

      const localBxNorm = uv().x.sub(0.5).mul(float(2.0 * uvInset));
      const uvB = uvMinB.add(vec2(uvSizeB.x.mul(localBxNorm), uvSizeB.y.mul(vyNorm)));

      demTexNode = mix(texture(demA, uvA), texture(demB, uvB), t);
      imgTexNode = mix(texture(imgA, uvA), texture(imgB, uvB), t);
    } else {
      const t = step(float(0.5), uv().y);
      const vxNorm = uv().x.mul(coreSpan).add(insetF);

      const localByNorm = uv().y.mul(float(2.0 * uvInset)).add(float(1 - uvInset));
      const uvB = uvMinB.add(vec2(uvSizeB.x.mul(vxNorm), uvSizeB.y.mul(localByNorm)));

      const localAyNorm = uv().y.sub(0.5).mul(float(2.0 * uvInset));
      const uvA = uvMinA.add(vec2(uvSizeA.x.mul(vxNorm), uvSizeA.y.mul(localAyNorm)));

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
    edge.tileA.source.requestTile.demTexture, edge.tileA.source.requestTile.imageryTexture,
    edge.tileB.source.requestTile.demTexture, edge.tileB.source.requestTile.imageryTexture,
    uvBoundsA.uMin, uvBoundsA.vMin, uvBoundsA.uMax, uvBoundsA.vMax,
    uvBoundsB.uMin, uvBoundsB.vMin, uvBoundsB.uMax, uvBoundsB.vMax,
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

  useEffect(() => { material.wireframe = debug.wireframe; }, [material, debug.wireframe]);
  useEffect(() => { nodes.uWireframeWhite.value = debug.wireframe ? 1.0 : 0.0; }, [nodes, debug.wireframe]);
  useEffect(() => { nodes.uHeightScaleFactor.value = heightScale * debug.displacementScale * worldUnitsPerMeter; }, [nodes, heightScale, debug.displacementScale, worldUnitsPerMeter]);
  useEffect(() => { nodes.uFlattenTerrain.value = debug.flattenTerrain ? 1.0 : 0.0; }, [nodes, debug.flattenTerrain]);
  useEffect(() => { nodes.uBase.value = decodeParams.base; nodes.uInterval.value = decodeParams.interval; }, [nodes, decodeParams]);
  useEffect(() => { return () => { geometry?.dispose(); }; }, [geometry]);
  useEffect(() => { return () => { material.dispose(); }; }, [material]);

  const aReady = edge.tileA.source.requestTile.demTexture && edge.tileA.source.requestTile.imageryTexture;
  const bReady = edge.tileB.source.requestTile.demTexture && edge.tileB.source.requestTile.imageryTexture;
  if (!aReady || !bReady) return null;

  return (
    <group position={[centerX, centerY, 0]}>
      <mesh geometry={geometry} frustumCulled={false}>
        <primitive object={material} attach="material" />
      </mesh>
    </group>
  );
}
