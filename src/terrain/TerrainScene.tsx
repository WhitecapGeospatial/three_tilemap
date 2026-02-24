import { useMemo, useRef } from "react";
import { WebMercatorViewport } from "@deck.gl/core";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { MapViewState, TileSize, DemDecodeParams } from "../types";
import type { TileRecord } from "./types";
import { TileTerrainMesh } from "./TileTerrainMesh";
import type { DebugVisState } from "../debugVis";

type TerrainSceneProps = {
  viewState: MapViewState;
  viewportSize: TileSize;
  tiles: TileRecord[];
  heightScale: number;
  debug: DebugVisState;
  decodeParams: DemDecodeParams;
};

// Build a WebMercatorViewport from current state (memoised outside components).
function makeViewport(viewState: MapViewState, viewportSize: TileSize) {
  return new WebMercatorViewport({
    ...viewState,
    width: Math.max(1, viewportSize.width),
    height: Math.max(1, viewportSize.height),
  });
}

// ---------------------------------------------------------------------------
// Camera sync – runs every frame via useFrame so matrices are always current
// before Three renders.  The critical fix vs. the previous useEffect version:
//   1. We set camera.matrix directly (not just camera.matrixWorld), so Three's
//      updateMatrixWorld() doesn't clobber our manual write.
//   2. useFrame runs before each draw; useEffect ran after paint.
// ---------------------------------------------------------------------------
function DeckSyncedCamera({
  viewState,
  viewportSize,
  logCamera,
  bypass,
}: {
  viewState: MapViewState;
  viewportSize: TileSize;
  logCamera: boolean;
  bypass: boolean;
}) {
  const { camera } = useThree();
  const loggedRef = useRef(false);

  // Store latest values in a ref so the useFrame closure always sees them.
  const stateRef = useRef({ viewState, viewportSize, logCamera, bypass });
  stateRef.current = { viewState, viewportSize, logCamera, bypass };

  useFrame(() => {
    const { viewState: vs, viewportSize: vp, logCamera: lc, bypass: bp } = stateRef.current;

    if (bp) {
      // Bypass mode: simple perspective camera looking straight down at the
      // viewport centre, giving a bird's-eye view of the tiles.
      const viewport = makeViewport(vs, vp);
      const [cx, cy] = viewport.projectPosition([vs.longitude, vs.latitude, 0]);
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

    // Normal mode: mirror Deck's view/projection matrices exactly.
    const viewport = makeViewport(vs, vp);

    // gl-matrix (used by deck.gl) produces column-major arrays – same layout
    // that THREE.Matrix4.fromArray() expects.
    const projection = new THREE.Matrix4().fromArray(viewport.projectionMatrix);
    const view = new THREE.Matrix4().fromArray(viewport.viewMatrix);
    const world = new THREE.Matrix4().copy(view).invert();

    // IMPORTANT: set camera.matrix (local transform) AND matrixWorld.
    // If we only set matrixWorld, a subsequent updateMatrixWorld() call
    // (which Three may issue internally) overwrites it from camera.matrix.
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
        viewState: vs,
        viewportSize: vp,
        projectionMatrix: Array.from(viewport.projectionMatrix),
        viewMatrix: Array.from(viewport.viewMatrix),
        cameraPos: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      });
    }
  });

  return null;
}

// A big red sphere at exact world-space origin [0,0,0]. If this is invisible,
// either Three isn't rendering at all or the Deck canvas is covering it.
function SanityMesh() {
  return (
    <mesh position={[0, 0, 0]}>
      <sphereGeometry args={[2, 16, 16]} />
      <meshBasicMaterial color="#ff0000" />
    </mesh>
  );
}

function CameraMarker({ viewState, viewportSize }: { viewState: MapViewState; viewportSize: TileSize }) {
  const markerPos = useMemo(() => {
    const viewport = makeViewport(viewState, viewportSize);
    const [cx, cy] = viewport.projectPosition([viewState.longitude, viewState.latitude, 0]);
    return [cx, cy, 0] as [number, number, number];
  }, [viewState, viewportSize]);

  return (
    <mesh position={markerPos}>
      <boxGeometry args={[0.03, 0.03, 0.03]} />
      <meshBasicMaterial color="#ff7f00" />
    </mesh>
  );
}

export function TerrainScene({ viewState, viewportSize, tiles, heightScale, debug, decodeParams }: TerrainSceneProps) {
  const filteredTiles = useMemo(() => {
    if (!debug.singleTileOnly) return tiles;
    return tiles.filter((tile) => tile.id === debug.singleTileId);
  }, [tiles, debug.singleTileId, debug.singleTileOnly]);

  return (
    <>
      <DeckSyncedCamera
        viewState={viewState}
        viewportSize={viewportSize}
        logCamera={debug.logCamera}
        bypass={debug.bypassDeckCamera}
      />
      <ambientLight intensity={0.6} />
      <directionalLight position={[0, 0, 2_000_000]} intensity={0.8} />
      {debug.sanityMesh ? <SanityMesh /> : null}
      {debug.showCameraMarker ? <CameraMarker viewState={viewState} viewportSize={viewportSize} /> : null}
      {filteredTiles
        .filter((tile) => tile.status === "ready")
        .map((tile) => (
          <TileTerrainMesh
            key={tile.id}
            tile={tile}
            viewState={viewState}
            viewportSize={viewportSize}
            heightScale={heightScale}
            debug={debug}
            decodeParams={decodeParams}
          />
        ))}
    </>
  );
}
