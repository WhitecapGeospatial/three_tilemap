# DeckGL + ThreeJS Terrain Renderer

A 3D terrain viewer that composites a ThreeJS scene on top of a DeckGL map, using DeckGL's WebMercator math to keep both renderers pixel-perfectly aligned.

## Architecture Overview

The two renderers are completely independent canvases, stacked via CSS. They never share a WebGL context or canvas element.

```
┌─────────────────────────────────┐
│  DeckGL canvas (pointer events) │  ← interaction layer, transparent background
├─────────────────────────────────┤
│  ThreeJS canvas (terrain mesh)  │  ← rendering layer
└─────────────────────────────────┘
```

ThreeJS renders the 3D terrain geometry. DeckGL renders nothing visible — its `TileLayer` has `renderSubLayers: () => null` — and exists solely as a **tile scheduler and interaction controller**.

## Source of Truth for Viewport State

**DeckGL is the sole source of truth for viewport/camera state.** The data flow is strictly unidirectional:

```
User interaction (pan / zoom / tilt)
    → DeckGL controller (pointer events)
    → onViewStateChange callback
    → Zustand viewStateStore
    → props down to TerrainScene + DeckGL
```

The Zustand store (`src/store/viewStateStore.ts`) holds a plain `MapViewState` object in geographic coordinates:

```ts
{
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
}
```

ThreeJS **never writes** to this store — it only reads from it.

## ThreeJS Camera Synchronisation

`DeckSyncedCamera` (`src/terrain/TerrainScene.tsx`) runs inside a `useFrame` hook, which fires every frame before ThreeJS draws. Each frame it:

1. Constructs a `WebMercatorViewport` from the current `MapViewState` and pixel dimensions of the canvas.
2. Reads `projectionMatrix` and `viewMatrix` directly off the viewport object.
3. Copies those matrices onto the Three camera, bypassing Three's own transform system.

```ts
camera.matrixAutoUpdate = false;   // prevent Three from overwriting our matrices
camera.matrix.copy(world);
camera.matrixWorld.copy(world);
camera.matrixWorldInverse.copy(view);
camera.projectionMatrix.copy(projection);
camera.projectionMatrixInverse.copy(projection).invert();
```

`matrixAutoUpdate = false` is critical: without it, Three's internal `updateMatrixWorld()` call would silently overwrite the injected matrices on the next traversal.

Using `useFrame` (rather than `useEffect`) ensures the camera is always correct before each draw, not after the previous paint.

## Coordinate System Bridge

`WebMercatorViewport` from `@deck.gl/core` is the shared math layer. Both renderers are expressed in DeckGL's WebMercator world-space units:

- **Tile geometry** is placed in world-space by converting tile indices + the current `MapViewState` into world bounds via `tileToWorldBounds` (`src/utils/tileMath.ts`).
- **The Three camera** is expressed in the same world-space because its matrices come directly from `WebMercatorViewport`.

Because both sides use the same viewport math, geometry automatically aligns with the camera at every zoom/pitch/bearing.

## Data Flow Summary

| Concern | Owner |
|---|---|
| User interaction (pan / zoom / tilt) | DeckGL controller |
| Viewport state (lng/lat/zoom/pitch/bearing) | Zustand store (written only by DeckGL) |
| Camera matrices (view + projection) | Computed from `WebMercatorViewport` each frame |
| Tile scheduling / LOD decisions | DeckGL `TileLayer` |
| Tile texture loading (DEM + imagery) | ThreeJS `TextureLoader` (triggered by DeckGL callbacks) |
| 3D rendering | ThreeJS / React Three Fiber |

## Key Files

| File | Role |
|---|---|
| `src/App.tsx` | Composes the two canvases; owns the DeckGL `onViewStateChange` handler |
| `src/store/viewStateStore.ts` | Zustand store holding `MapViewState` |
| `src/terrain/TerrainScene.tsx` | `DeckSyncedCamera` — per-frame matrix injection into the Three camera |
| `src/terrain/TileTerrainMesh.tsx` | ThreeJS mesh per tile; TSL vertex shader for DEM displacement |
| `src/terrain/useDeckTileTerrain.ts` | DeckGL `TileLayer` wired to load Three textures; manages tile lifecycle |
| `src/utils/tileMath.ts` | Converts tile indices → WebMercator world-space bounds |
