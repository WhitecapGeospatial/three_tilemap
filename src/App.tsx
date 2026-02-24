import { useEffect, useMemo, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
import { Canvas, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { MapViewState, TileSize } from "./types";
import { useViewStateStore } from "./store/viewStateStore";
import { useDeckTileTerrain } from "./terrain/useDeckTileTerrain";
import { TerrainScene } from "./terrain/TerrainScene";
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

export function App() {
  const { viewState, setViewState } = useViewStateStore();
  const { ref, size } = useElementSize<HTMLDivElement>();
  const [debug, setDebug] = useState(DEFAULT_DEBUG_VIS_STATE);
  const [rendererType, setRendererType] = useState<string>("…");
  const { layer, tileRecords, decodeParams } = useDeckTileTerrain({
    base: -10000,
    interval: 0.1,
  });

  const layers = useMemo(() => [layer], [layer]);

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
          viewState={viewState}
          viewportSize={size}
          tiles={tileRecords}
          heightScale={HEIGHT_SCALE}
          debug={debug}
          decodeParams={decodeParams}
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
          controller={true}
          viewState={viewState}
          onViewStateChange={({ viewState: nextViewState }) => {
            setViewState(nextViewState as Partial<MapViewState>);
          }}
        />
      </div>

      <div className="hud">
        <div>Renderer: {rendererType}</div>
        <div>Tiles ready: {tileRecords.filter((tile) => tile.status === "ready").length}</div>
        <div>Tiles loading/error: {tileRecords.filter((tile) => tile.status !== "ready").length}</div>
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
