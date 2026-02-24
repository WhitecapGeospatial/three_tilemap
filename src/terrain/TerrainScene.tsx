import { useMemo, useRef } from "react";
import { WebMercatorViewport, FirstPersonViewport } from "@deck.gl/core";
import { getMeterZoom } from "@math.gl/web-mercator";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { MapViewState, FirstPersonViewState, ViewMode, TileSize, DemDecodeParams } from "../types";
import type { TileRecord } from "./types";
import { TileTerrainMesh } from "./TileTerrainMesh";
import type { DebugVisState } from "../debugVis";

type TerrainSceneProps = {
  mapViewState: MapViewState;
  fpViewState: FirstPersonViewState;
  mode: ViewMode;
  viewportSize: TileSize;
  tiles: TileRecord[];
  heightScale: number;
  debug: DebugVisState;
  decodeParams: DemDecodeParams;
};

function makeViewport(
  mapViewState: MapViewState,
  fpViewState: FirstPersonViewState,
  viewportSize: TileSize,
  mode: ViewMode,
) {
  const w = Math.max(1, viewportSize.width);
  const h = Math.max(1, viewportSize.height);

  if (mode === "firstPerson") {
    return new FirstPersonViewport({
      ...fpViewState,
      width: w,
      height: h,
      fovy: 75,
      near: 0.1,
      far: 100000,
    });
  }

  return new WebMercatorViewport({
    ...mapViewState,
    width: w,
    height: h,
  });
}

function DeckSyncedCamera({
  mapViewState,
  fpViewState,
  mode,
  viewportSize,
  logCamera,
  bypass,
}: {
  mapViewState: MapViewState;
  fpViewState: FirstPersonViewState;
  mode: ViewMode;
  viewportSize: TileSize;
  logCamera: boolean;
  bypass: boolean;
}) {
  const { camera } = useThree();
  const loggedRef = useRef(false);

  const stateRef = useRef({ mapViewState, fpViewState, mode, viewportSize, logCamera, bypass });
  stateRef.current = { mapViewState, fpViewState, mode, viewportSize, logCamera, bypass };

  useFrame(() => {
    const { mapViewState: mvs, fpViewState: fvs, mode: m, viewportSize: vp, logCamera: lc, bypass: bp } =
      stateRef.current;

    if (bp) {
      const viewport = makeViewport(mvs, fvs, vp, "map");
      const [cx, cy] = viewport.projectPosition([mvs.longitude, mvs.latitude, 0]);
      camera.matrixAutoUpdate = true;
      (camera as THREE.PerspectiveCamera).fov = 50;
      (camera as THREE.PerspectiveCamera).aspect = Math.max(1, vp.width) / Math.max(1, vp.height);
      (camera as THREE.PerspectiveCamera).near = 0.001;
      (camera as THREE.PerspectiveCamera).far = 1_000;
      (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
      camera.position.set(cx, cy, 5);
      camera.lookAt(cx, cy, 0);
      return;
    }

    const viewport = makeViewport(mvs, fvs, vp, m);

    const projection = new THREE.Matrix4().fromArray(viewport.projectionMatrix);
    const view = new THREE.Matrix4().fromArray(viewport.viewMatrix);
    const world = new THREE.Matrix4().copy(view).invert();

    camera.matrixAutoUpdate = false;
    camera.matrix.copy(world);
    camera.matrixWorld.copy(world);
    camera.matrixWorldInverse.copy(view);
    camera.projectionMatrix.copy(projection);
    camera.projectionMatrixInverse.copy(projection).invert();

    if (lc && !loggedRef.current) {
      loggedRef.current = true;
      camera.position.setFromMatrixPosition(world);
      camera.quaternion.setFromRotationMatrix(world);
      console.info("[camera-sync] first frame", {
        mode: m,
        mapViewState: mvs,
        fpViewState: fvs,
        viewportSize: vp,
        projectionMatrix: Array.from(viewport.projectionMatrix),
        viewMatrix: Array.from(viewport.viewMatrix),
        cameraPos: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      });
    }
  });

  return null;
}

function SanityMesh() {
  return (
    <mesh position={[0, 0, 0]}>
      <sphereGeometry args={[2, 16, 16]} />
      <meshBasicMaterial color="#ff0000" />
    </mesh>
  );
}

function CameraMarker({
  mapViewState,
  fpViewState,
  mode,
  viewportSize,
}: {
  mapViewState: MapViewState;
  fpViewState: FirstPersonViewState;
  mode: ViewMode;
  viewportSize: TileSize;
}) {
  const markerPos = useMemo(() => {
    const viewport = makeViewport(mapViewState, fpViewState, viewportSize, mode);
    const lng = mode === "firstPerson" ? fpViewState.longitude : mapViewState.longitude;
    const lat = mode === "firstPerson" ? fpViewState.latitude : mapViewState.latitude;
    const [cx, cy] = viewport.projectPosition([lng, lat, 0]);
    return [cx, cy, 0] as [number, number, number];
  }, [mapViewState, fpViewState, mode, viewportSize]);

  return (
    <mesh position={markerPos}>
      <boxGeometry args={[0.03, 0.03, 0.03]} />
      <meshBasicMaterial color="#ff7f00" />
    </mesh>
  );
}

export function TerrainScene({
  mapViewState,
  fpViewState,
  mode,
  viewportSize,
  tiles,
  heightScale,
  debug,
  decodeParams,
}: TerrainSceneProps) {
  const filteredTiles = useMemo(() => {
    if (!debug.singleTileOnly) return tiles;
    return tiles.filter((tile) => tile.id === debug.singleTileId);
  }, [tiles, debug.singleTileId, debug.singleTileOnly]);

  const syntheticZoom = useMemo(
    () =>
      mode === "firstPerson" ? getMeterZoom({ latitude: fpViewState.latitude }) : undefined,
    [mode, fpViewState.latitude],
  );

  const tileViewState = mode === "firstPerson" ? fpViewState : mapViewState;

  return (
    <>
      <DeckSyncedCamera
        mapViewState={mapViewState}
        fpViewState={fpViewState}
        mode={mode}
        viewportSize={viewportSize}
        logCamera={debug.logCamera}
        bypass={debug.bypassDeckCamera}
      />
      <ambientLight intensity={0.6} />
      <directionalLight position={[0, 0, 2_000_000]} intensity={0.8} />
      {debug.sanityMesh ? <SanityMesh /> : null}
      {debug.showCameraMarker ? (
        <CameraMarker
          mapViewState={mapViewState}
          fpViewState={fpViewState}
          mode={mode}
          viewportSize={viewportSize}
        />
      ) : null}
      {filteredTiles
        .filter((tile) => tile.status === "ready")
        .map((tile) => (
          <TileTerrainMesh
            key={tile.id}
            tile={tile}
            viewState={tileViewState}
            viewportSize={viewportSize}
            heightScale={heightScale}
            debug={debug}
            decodeParams={decodeParams}
            zoomOverride={syntheticZoom}
          />
        ))}
    </>
  );
}
