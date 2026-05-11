import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
import { FirstPersonView, FirstPersonViewport } from "@deck.gl/core";
import { Canvas, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { MapViewState, FirstPersonViewState, TileSize } from "./types";
import { useViewStateStore } from "./store/viewStateStore";
import { useDeckTileTerrain } from "./terrain/useDeckTileTerrain";
import { useRenderedTileGrid, computeVisibleRange } from "./terrain/useRenderedTileGrid";
import { TerrainScene } from "./terrain/TerrainScene";
import { TileInfoPanel } from "./ui/TileInfoPanel";
import { DEBUG_VIS, DEFAULT_DEBUG_VIS_STATE } from "./debugVis";

function RendererInfo({ onInfo }: { onInfo: (info: string) => void }) {
  const { gl } = useThree();
  useEffect(() => {
    const label = "isWebGPURenderer" in gl ? "WebGPU" : "WebGL";
    onInfo(label);
  }, [gl, onInfo]);
  return null;
}

const HEIGHT_SCALE = 1;
const MAX_RENDER_ZOOM = 9;
const MIN_REQUEST_ZOOM = 3;
const SETTLE_DEBOUNCE_MS = 500;
const GAP_FILL_DELAY_MS = 500;

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<TileSize>({ width: 1, height: 1 });

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      setSize({
        width: Math.max(1, Math.round(entry.contentRect.width)),
        height: Math.max(1, Math.round(entry.contentRect.height)),
      });
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, size };
}

async function createRenderer(props: ConstructorParameters<typeof THREE.WebGLRenderer>[0]) {
  try {
    const webgpuModule = await import("three/webgpu");
    const WebGPURendererCtor = (webgpuModule as { WebGPURenderer?: new (params: object) => THREE.WebGLRenderer })
      .WebGPURenderer;

    if (!WebGPURendererCtor) {
      throw new Error("WebGPURenderer is unavailable in this Three build.");
    }

    const renderer = new WebGPURendererCtor({
      ...props,
      antialias: true,
      alpha: true,
    });

    if ("init" in renderer && typeof (renderer as { init?: () => Promise<void> }).init === "function") {
      await (renderer as { init: () => Promise<void> }).init();
    }

    return renderer;
  } catch {
    return new THREE.WebGLRenderer({
      ...props,
      antialias: true,
      alpha: true,
    });
  }
}

const fpView = new FirstPersonView({
  id: "fp",
  controller: {
    keyboard: false,
  } as FirstPersonView["props"]["controller"],
  fovy: 75,
  near: 0.1,
  far: 5_000_000,
});

const DEFAULT_MOVEMENT_SPEED = 50000;
const LOOK_SPEED_DEG_PER_SECOND = 90;
const MAX_MERCATOR_LATITUDE = 85.051129;
const FP_NEAR = 0.1;
const FP_FAR = 5_000_000;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function wrapLongitude(longitude: number) {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

function isTextInputTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tagName = target.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
}

function useSettleDetector(
  mapViewState: MapViewState,
  fpViewState: FirstPersonViewState,
  mode: string,
): number {
  const [generation, setGeneration] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setGeneration((g) => g + 1);
    }, SETTLE_DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [
    mapViewState.longitude, mapViewState.latitude, mapViewState.zoom,
    mapViewState.pitch, mapViewState.bearing,
    fpViewState.longitude, fpViewState.latitude,
    fpViewState.position[0], fpViewState.position[1], fpViewState.position[2],
    fpViewState.pitch, fpViewState.bearing,
    mode,
  ]);

  return generation;
}

export function App() {
  const { mode, mapViewState, fpViewState, setMode, setMapViewState, setFpViewState } = useViewStateStore();
  const { ref, size } = useElementSize<HTMLDivElement>();
  const [debug, setDebug] = useState(DEFAULT_DEBUG_VIS_STATE);
  const [rendererType, setRendererType] = useState<string>("…");
  const [movementSpeed, setMovementSpeed] = useState(DEFAULT_MOVEMENT_SPEED);
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);

  const handleSelectTile = useCallback((id: string | null) => {
    setSelectedTileId((prev) => (prev === id ? null : id));
  }, []);

  const requestGeneration = useSettleDetector(mapViewState, fpViewState, mode);

  const { layer, requestTileCache, decodeParams, pruneUnusedTiles, fetchTiles } = useDeckTileTerrain(
    { base: -10000, interval: 0.1 },
    MIN_REQUEST_ZOOM,
    MAX_RENDER_ZOOM,
    requestGeneration,
    mapViewState.zoom,
  );

  const { renderedTiles, edgeRecords, cornerRecords } = useRenderedTileGrid(
    requestTileCache,
    mapViewState,
    size,
    MIN_REQUEST_ZOOM,
    MAX_RENDER_ZOOM,
    mapViewState.zoom,
  );

  const referencedRequestIds = useMemo(() => {
    const ids = new Set<string>();
    for (const tile of renderedTiles) {
      ids.add(tile.source.requestTile.id);
    }
    return ids;
  }, [renderedTiles]);

  useEffect(() => {
    pruneUnusedTiles(referencedRequestIds);
  }, [requestGeneration, pruneUnusedTiles, referencedRequestIds]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const range = computeVisibleRange(mapViewState, size, MAX_RENDER_ZOOM);
      const missing: { x: number; y: number; z: number }[] = [];
      for (let x = range.xMin; x <= range.xMax; x++) {
        for (let y = range.yMin; y <= range.yMax; y++) {
          const id = `${MAX_RENDER_ZOOM}/${x}/${y}`;
          const cached = requestTileCache.get(id);
          if (!cached || cached.status === "error") {
            missing.push({ x, y, z: MAX_RENDER_ZOOM });
          }
        }
      }
      if (missing.length > 0) fetchTiles(missing);
    }, GAP_FILL_DELAY_MS);
    return () => clearTimeout(timer);
  }, [requestGeneration, mapViewState, size, requestTileCache, fetchTiles]);

  const layers = useMemo(() => [layer], [layer]);

  const isFirstPerson = mode === "firstPerson";
  const fpStateRef = useRef(fpViewState);

  useEffect(() => {
    fpStateRef.current = fpViewState;
  }, [fpViewState]);

  useEffect(() => {
    if (!isFirstPerson) {
      return;
    }

    const activeKeys = new Set<string>();
    const trackedKeys = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "KeyR", "KeyF", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

    let rafId = 0;
    let previousTime = performance.now();

    const tick = (now: number) => {
      const dt = (now - previousTime) / 1000;
      previousTime = now;

      const current = fpStateRef.current;
      const [x0, y0, z0] = current.position;
      let x = x0;
      let y = y0;
      let z = z0;
      let bearing = current.bearing;
      let pitch = current.pitch;

      const lookStep = LOOK_SPEED_DEG_PER_SECOND * dt;
      if (activeKeys.has("ArrowLeft")) {
        bearing -= lookStep;
      }
      if (activeKeys.has("ArrowRight")) {
        bearing += lookStep;
      }
      if (activeKeys.has("ArrowUp")) {
        pitch += lookStep;
      }
      if (activeKeys.has("ArrowDown")) {
        pitch -= lookStep;
      }

      const minPitch = current.minPitch ?? -89;
      const maxPitch = current.maxPitch ?? 89;
      pitch = clamp(pitch, minPitch, maxPitch);

      const moveStep = movementSpeed * dt;
      const viewport = new FirstPersonViewport({
        longitude: current.longitude,
        latitude: current.latitude,
        position: current.position,
        bearing,
        pitch,
        width: 1,
        height: 1,
        fovy: 75,
        near: FP_NEAR,
        far: FP_FAR,
      });
      const view = new THREE.Matrix4().fromArray(viewport.viewMatrix);
      const world = new THREE.Matrix4().copy(view).invert();
      const right = new THREE.Vector3();
      const up = new THREE.Vector3();
      const localForward = new THREE.Vector3();
      world.extractBasis(right, up, localForward);
      const forward = localForward.multiplyScalar(-1).normalize();
      right.normalize();

      if (activeKeys.has("KeyW")) {
        x += forward.x * moveStep;
        y += forward.y * moveStep;
        z += forward.z * moveStep;
      }
      if (activeKeys.has("KeyS")) {
        x -= forward.x * moveStep;
        y -= forward.y * moveStep;
        z -= forward.z * moveStep;
      }
      if (activeKeys.has("KeyD")) {
        x += right.x * moveStep;
        y += right.y * moveStep;
        z += right.z * moveStep;
      }
      if (activeKeys.has("KeyA")) {
        x -= right.x * moveStep;
        y -= right.y * moveStep;
        z -= right.z * moveStep;
      }
      if (activeKeys.has("KeyR")) {
        z += moveStep;
      }
      if (activeKeys.has("KeyF")) {
        z -= moveStep;
      }

      const hasPositionChange = x !== x0 || y !== y0 || z !== z0;
      const hasOrientationChange = bearing !== current.bearing || pitch !== current.pitch;
      if (hasPositionChange || hasOrientationChange) {
        const nextViewport = new FirstPersonViewport({
          longitude: current.longitude,
          latitude: current.latitude,
          position: [x, y, z],
          bearing,
          pitch,
          width: 1,
          height: 1,
          fovy: 75,
          near: FP_NEAR,
          far: FP_FAR,
        });
        const cameraWorld = nextViewport.cameraPosition as [number, number, number];
        const [nextLng, nextLat, nextAlt] = nextViewport.unprojectPosition(cameraWorld);
        const safeLng = Number.isFinite(nextLng) ? wrapLongitude(nextLng) : current.longitude;
        const safeLat = Number.isFinite(nextLat)
          ? clamp(nextLat, -MAX_MERCATOR_LATITUDE, MAX_MERCATOR_LATITUDE)
          : current.latitude;
        const safeAlt = Number.isFinite(nextAlt) ? nextAlt : z;

        setFpViewState({
          longitude: safeLng,
          latitude: safeLat,
          position: [0, 0, safeAlt],
          bearing,
          pitch,
        });
      }

      rafId = window.requestAnimationFrame(tick);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextInputTarget(event.target)) {
        return;
      }
      if (!trackedKeys.has(event.code)) {
        return;
      }
      event.preventDefault();
      activeKeys.add(event.code);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (!trackedKeys.has(event.code)) {
        return;
      }
      event.preventDefault();
      activeKeys.delete(event.code);
    };

    const onBlur = () => {
      activeKeys.clear();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    rafId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [isFirstPerson, movementSpeed, setFpViewState]);

  return (
    <div ref={ref} className="app-root">
      <Canvas
        className="three-canvas"
        gl={createRenderer}
        dpr={[1, 2]}
        camera={{ near: 0.01, far: 1_000_000_000_000, fov: 50 }}
      >
        <RendererInfo onInfo={setRendererType} />
        <TerrainScene
          mapViewState={mapViewState}
          fpViewState={fpViewState}
          mode={mode}
          viewportSize={size}
          renderedTiles={renderedTiles}
          edgeRecords={edgeRecords}
          cornerRecords={cornerRecords}
          maxRenderZoom={MAX_RENDER_ZOOM}
          heightScale={HEIGHT_SCALE}
          debug={debug}
          decodeParams={decodeParams}
          selectedTileId={selectedTileId}
          onSelectTile={handleSelectTile}
        />
      </Canvas>

      <div
        className="deck-canvas"
        style={{
          opacity: debug.hideDeckOverlay ? 0 : 1,
          pointerEvents: debug.hideDeckOverlay ? "none" : "auto",
        }}
      >
        <DeckGL
          width="100%"
          height="100%"
          style={{ backgroundColor: "transparent" }}
          parameters={{ clearColor: [0, 0, 0, 0] } as never}
          useDevicePixels={1}
          deviceProps={{ type: "webgl", webgl: { alpha: true, premultipliedAlpha: true } }}
          layers={layers}
          views={isFirstPerson ? fpView : undefined}
          controller={isFirstPerson ? undefined : true}
          viewState={isFirstPerson ? fpViewState : mapViewState}
          onViewStateChange={({ viewState: nextViewState }) => {
            if (isFirstPerson) {
              setFpViewState(nextViewState as Partial<FirstPersonViewState>);
            } else {
              setMapViewState(nextViewState as Partial<MapViewState>);
            }
          }}
        />
      </div>

      <TileInfoPanel
        renderedTiles={renderedTiles}
        requestTileCache={requestTileCache}
        maxRenderZoom={MAX_RENDER_ZOOM}
        minRequestZoom={MIN_REQUEST_ZOOM}
        selectedTileId={selectedTileId}
        onSelectTile={handleSelectTile}
      />

      <div className="hud">
        <div>Renderer: {rendererType}</div>

        <button
          className="mode-toggle"
          onClick={() => setMode(isFirstPerson ? "map" : "firstPerson")}
          type="button"
        >
          {isFirstPerson ? "Switch to Map" : "Switch to First Person"}
        </button>

        {isFirstPerson && (
          <div className="fp-hint">
            WASD: move &middot; R/F: up/down &middot; Arrows: look &middot; Mouse: look
            <label className="speed-control">
              Move speed:
              <input
                type="number"
                min={1}
                step={1}
                value={movementSpeed}
                onChange={(e) => {
                  const value = Number.parseFloat(e.target.value);
                  if (!Number.isFinite(value)) {
                    return;
                  }
                  setMovementSpeed(Math.max(1, value));
                }}
              />
            </label>
          </div>
        )}

        {DEBUG_VIS ? (
          <div className="debug-panel">
            <div className="debug-title">Debug Vis</div>
            <label>
              <input
                type="checkbox"
                checked={debug.hideDeckOverlay}
                onChange={(e) => setDebug((prev) => ({ ...prev, hideDeckOverlay: e.target.checked }))}
              />
              Hide Deck overlay
            </label>
            <label>
              <input
                type="checkbox"
                checked={debug.wireframe}
                onChange={(e) => setDebug((prev) => ({ ...prev, wireframe: e.target.checked }))}
              />
              Wireframe terrain
            </label>
            <label>
              <input
                type="checkbox"
                checked={debug.showTileCorners}
                onChange={(e) => setDebug((prev) => ({ ...prev, showTileCorners: e.target.checked }))}
              />
              Show tile corners
            </label>
            <label>
              <input
                type="checkbox"
                checked={debug.showCameraMarker}
                onChange={(e) => setDebug((prev) => ({ ...prev, showCameraMarker: e.target.checked }))}
              />
              Show camera marker cube
            </label>
            <label>
              Displacement scale:
              <input
                type="number"
                min={0}
                step={0.1}
                value={debug.displacementScale}
                onChange={(e) => {
                  const nextValue = Number.parseFloat(e.target.value);
                  setDebug((prev) => ({
                    ...prev,
                    displacementScale: Number.isFinite(nextValue) ? Math.max(0, nextValue) : prev.displacementScale,
                  }));
                }}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={debug.flattenTerrain}
                onChange={(e) => setDebug((prev) => ({ ...prev, flattenTerrain: e.target.checked }))}
              />
              Flatten displacement
            </label>
            <label>
              <input
                type="checkbox"
                checked={debug.singleTileOnly}
                onChange={(e) => setDebug((prev) => ({ ...prev, singleTileOnly: e.target.checked }))}
              />
              Single tile only
            </label>
            <label>
              Tile ID:
              <input
                className="debug-tile-id"
                value={debug.singleTileId}
                onChange={(e) => setDebug((prev) => ({ ...prev, singleTileId: e.target.value }))}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={debug.sanityMesh}
                onChange={(e) => setDebug((prev) => ({ ...prev, sanityMesh: e.target.checked }))}
              />
              Sanity sphere at [0,0,0]
            </label>
            <label>
              <input
                type="checkbox"
                checked={debug.bypassDeckCamera}
                onChange={(e) => setDebug((prev) => ({ ...prev, bypassDeckCamera: e.target.checked }))}
              />
              Bypass Deck camera (bird's-eye)
            </label>
            <label>
              <input
                type="checkbox"
                checked={debug.logCamera}
                onChange={(e) => setDebug((prev) => ({ ...prev, logCamera: e.target.checked }))}
              />
              Log camera sync (once)
            </label>
            <label>
              <input
                type="checkbox"
                checked={debug.logTileBounds}
                onChange={(e) => setDebug((prev) => ({ ...prev, logTileBounds: e.target.checked }))}
              />
              Log tile bounds (once)
            </label>
          </div>
        ) : null}
      </div>
    </div>
  );
}
