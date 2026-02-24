DeckGL TileLayer → ThreeJS Terrain (WebGPU) in React Three Fiber

A step-by-step implementation plan for XYZ displacement + imagery overlay, using DeckGL for tile selection/loading and ThreeJS (WebGPU) for rendering.

⸻

1) Goals and scope

What you will build
	•	A 3D terrain surface where:
	•	Geometry is displaced from a DEM tile served as PNG from an XYZ endpoint.
	•	Albedo / imagery is a texture overlay from an XYZ imagery endpoint.
	•	DeckGL TileLayer is used for:
	•	viewport-driven tile selection
	•	request scheduling / caching
	•	tile lifecycle callbacks (onTileLoad, onTileUnload, etc.)  ￼
	•	ThreeJS (WebGPURenderer) + React Three Fiber is used for:
	•	generating a mesh per tile (or per group of tiles)
	•	sampling textures & applying displacement/imagery
	•	rendering via WebGPU (with WebGL2 fallback via Three’s WebGPURenderer)  ￼

Explicit constraints
	•	Support XYZ tile patterns only (z/x/y and z/y/x variants).
	•	No custom tiling schemes (quadkey/H3/etc.) at this stage (TileLayer supports custom TilesetClass but not needed for this plan).  ￼

⸻

2) Data sources

Displacement (DEM) tiles (XYZ z/x/y)

https://cogserver-staging-myzvqet7ua-uw.a.run.app/get_rgb_tile/{z}/{x}/{y}.png?dataset=GlobalTopoBath.tif

Imagery tiles (XYZ but path order is z/y/x)

https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}

DEM decoding (assumption + how to make it configurable)

Your DEM endpoint is named get_rgb_tile, which strongly suggests an RGB-encoded elevation tile. A very common convention is Mapbox Terrain-RGB, decoded as:

elevation_m = -10000 + (R*256*256 + G*256 + B) * 0.1  ￼

Plan requirement: implement decoding as configurable (base, interval) with defaults above, so you can adapt if your server uses Terrarium or a custom encoding.

⸻

3) Architecture overview (Option A)

Two-canvas overlay (recommended for stability)
	•	DeckGL canvas (can be transparent / not rendering tiles) runs TileLayer to manage which tiles should be loaded at any moment.
	•	R3F canvas (WebGPU) renders the terrain.

You sync them via shared React state:
	•	viewState lives in React (or Zustand/Jotai).
	•	DeckGL updates it via onViewStateChange.  ￼
	•	R3F consumes it to position its camera (or a “camera rig”).

Note: deck.gl WebGPU is explicitly “work in progress / not production ready” right now.  ￼
This plan uses WebGPU for Three rendering, while Deck runs as a loader/controller (and may still be WebGL under the hood).

⸻

4) Coordinate system choice

Use WebMercator “world space” to match Deck’s tile math
	•	TileLayer is designed around map viewports, and Deck provides WebMercatorViewport which projects between lon/lat and world/screen coordinates.  ￼

Practical choice:
	•	Treat each tile as a rectangle in WebMercator world units at its zoom level.
	•	Build the tile mesh in a local tile coordinate frame, then place it into world space using the tile’s bounds.

This keeps:
	•	tile positioning easy
	•	camera sync tractable
	•	LOD consistent across zoom levels

⸻

5) Implementation plan

Step 0 — Dependencies and project setup
	1.	Create a React app (Vite recommended).
	2.	Install:
	•	three (use the WebGPU build via three/webgpu when you wire the renderer)
	•	@react-three/fiber
	•	@deck.gl/react and @deck.gl/geo-layers (TileLayer)
	•	@deck.gl/core (viewports / view state types)
	3.	Confirm R3F WebGPU support approach:
	•	R3F allows Canvas gl={async (props) => ...} for async renderers like WebGPURenderer.  ￼
	•	Three’s WebGPURenderer falls back to WebGL2 if WebGPU isn’t available.  ￼

⸻

Step 1 — Build a shared viewState store (single source of truth)
	1.	Define viewState shape compatible with MapView:
	•	{ longitude, latitude, zoom, pitch, bearing } (+ optional maxZoom/minZoom)
	2.	Put it in a store (React state is fine; Zustand is nicer).
	3.	Render DeckGL with:
	•	controller={true}
	•	viewState={viewState}
	•	onViewStateChange={({viewState}) => setViewState(viewState)}  ￼

Result: Deck handles interaction and updates viewState.

⸻

Step 2 — Create a TileLayer that loads DEM + imagery tiles (but doesn’t render them in Deck)

TileLayer’s core contract:
	•	getTileData(tile) loads data per tile.  ￼
	•	onTileLoad(tile) and onTileUnload(tile) let you manage lifecycle.  ￼

Implement one TileLayer that, for each tile index {x,y,z}, loads:
	•	DEM PNG (your server)
	•	imagery PNG (Esri server)

Important: The Esri URL is {z}/{y}/{x}, not {z}/{x}/{y}.

Pseudo-structure (conceptual):

function demUrl({z,x,y}) => `.../${z}/${x}/${y}.png?...`;
function imgUrl({z,x,y}) => `.../tile/${z}/${y}/${x}`;

async function getTileData({x,y,z, signal}) {
  const [demBlob, imgBlob] = await Promise.all([
    fetch(demUrl({z,x,y}), {signal}).then(r => r.blob()),
    fetch(imgUrl({z,x,y}), {signal}).then(r => r.blob()),
  ]);
  return { demBlob, imgBlob };
}

TileLayer supports abort via signal as part of tile request props; use it so fast pans cancel in-flight fetches.  ￼

⸻

Step 3 — Convert tile blobs → GPU textures (WebGPU via Three)

You need to turn Blob into something Three can upload:
	•	Use createImageBitmap(blob) (fast, async).
	•	Create Three Texture objects from bitmaps (or use Three’s loaders if you prefer).

WebGPU texture uploading details differ by implementation, but the key is: use ImageBitmap and let Three handle GPU upload (don’t manually write WebGPU texture code unless you must). For background, WebGPU texture import commonly uses copyExternalImageToTexture under the hood.  ￼

Deliverable:
	•	TileGpuResources = { demTexture, imgTexture } per tile, plus metadata.

⸻

Step 4 — Decide how to apply displacement (two viable approaches)

Approach 4B (higher performance long-term): GPU displacement in vertex shader
	1.	Keep a flat grid mesh per tile (constant topology).
	2.	In the material’s vertex stage, sample the DEM texture and displace the vertex.
	3.	Overlay imagery in fragment stage as base color.

Pros:
	•	Minimal CPU work; dynamic LOD changes are easier.

Cons:
	•	Requires reliable vertex texture sampling and a shader/material path in Three WebGPU.
	•	You may need Three’s node-based material pipeline in WebGPU contexts (still evolving in practice).

Recommendation: implement 4A first, then upgrade to 4B once everything is stable.

⸻

Step 5 — Build a “TileMesh” component in R3F

For each visible tile, you’ll render a mesh with:
	•	geometry: displaced grid (Approach 4A) OR flat grid (4B)
	•	material: textured with imagery
	•	transform: positioned in world space to match the tile bounds

You need:
	•	tileId
	•	tileIndex {x,y,z}
	•	tileBounds (in lon/lat or world coords)
	•	textures (imagery, optional dem)
	•	heightScale and decodeParams

⸻

Step 6 — Compute tile bounds and place meshes correctly

TileLayer tiles can provide bounding boxes; regardless, you can compute bounds from {x,y,z} in WebMercator:
	1.	Convert {x,y,z} → lon/lat bounds (standard slippy map math).
	2.	Convert lon/lat bounds → world coordinates using a WebMercatorViewport created from current viewState.  ￼
	3.	Place the tile mesh so its corners match those world points.
	4.	Use z=0 baseline for the terrain surface (elevation displaces along +Z in your Three scene).

Deliverable: a helper tileToWorldBounds(viewState, x,y,z) returning:
	•	worldMinX, worldMinY, worldMaxX, worldMaxY
	•	and optionally a worldCenter

⸻

Step 7 — Camera sync: derive a Three camera from Deck viewState

Deck’s Viewports are explicitly “a geospatially enabled camera” with projection utilities.  ￼

Target: Your R3F camera should match Deck’s MapView camera.

Implementation strategy:
	1.	On every viewState change, construct a WebMercatorViewport(viewState).  ￼
	2.	Extract or compute:
	•	camera position in world space
	•	look direction (bearing/pitch)
	•	perspective parameters consistent with deck’s viewport
	3.	Apply to R3F PerspectiveCamera (position/quaternion + projection matrix).
	4.	Ensure the R3F canvas size matches the Deck canvas size (or use a shared layout container).

Practical shortcut (often used):
	•	Use Deck’s viewport matrices as the source of truth:
	•	Build a Three camera whose projectionMatrix and matrixWorldInverse mirror Deck’s view/projection.
	•	This keeps the two renderers perfectly aligned even if you later add transitions.

(You’ll do a small amount of linear algebra here; the plan is: “Deck computes matrices; Three consumes them.”)

⸻

Step 8 — Tile lifecycle: maintain a visible-tile map between Deck and R3F

Use TileLayer callbacks:
	•	onTileLoad(tile) → insert/update tile entry (and trigger GPU texture + mesh generation)
	•	onTileUnload(tile) → remove entry and dispose resources
	•	Optional: onViewportLoad(tiles) → bulk reconciliation when the set stabilizes  ￼

Suggested internal structure:
	•	Map<string, TileRecord>
	•	id
	•	{x,y,z}
	•	demBlob/imgBlob (optional)
	•	demTexture/imgTexture
	•	heightField (if CPU decoded)
	•	status: loading|ready|error
	•	lastUsed timestamp

Important: TileLayer can unload/reload frequently depending on refinement and viewport movement; build your own small cache on top if needed. TileLayer has properties like refinementStrategy, maxRequests, debounceTime that affect churn.  ￼

⸻

Step 9 — LOD strategy (so this stays fast)

Start simple:
	1.	Geometry resolution per tile as a function of zoom:
	•	z ≤ 6: 32×32 grid
	•	7–10: 64×64
	•	11–14: 128×128 (only if performance allows)
	2.	Height decode + mesh generation runs in a Web Worker for CPU approach 4A.
	3.	Imagery texture can stay full 256×256.

Later improvements:
	•	Stitch edges between neighbor tiles (or add skirts) to reduce cracks.
	•	Cache decoded heightfields by tile id.

⸻

Step 10 — Rendering order and UX
	•	Put Deck canvas on top only if you need Deck picking/UI overlays.
	•	Otherwise keep Deck canvas transparent and pointer-events enabled (for controller), and render R3F beneath.

You can add debug overlays:
	•	wireframe toggle
	•	show tile boundaries
	•	show which tiles are currently loaded

⸻

6) Acceptance checklist (first working milestone)
	1.	Panning/zooming in Deck updates viewState and moves the Three terrain camera in sync.  ￼
	2.	As you pan, tiles stream in/out:
	•	new tiles appear in Three
	•	old tiles are disposed cleanly (no GPU memory runaway)
	3.	Imagery aligns to geometry with no visible tile offset.
	4.	Elevation decoding produces plausible heights (mountains positive, ocean bathymetry negative if present).
	5.	Performance is stable during fast interactions (requests cancel properly using tile signal).  ￼

⸻

7) Notes on WebGPU maturity (important)
	•	deck.gl’s WebGPU path is an early preview and not production-ready.  ￼
	•	Three’s WebGPURenderer is the intended WebGPU route in Three and supports fallback behavior.  ￼
	•	R3F supports async renderer initialization for WebGPU via the gl prop returning a promise.  ￼

This is why the plan cleanly separates:
	•	Deck = tile selection/loading + camera interaction
	•	Three WebGPU = rendering

⸻

8) Next extensions (after the baseline works)
	•	GPU displacement (Approach 4B) to reduce CPU load.
	•	Normal map generation from heightfield for better lighting.
	•	Tile edge stitching / skirts to eliminate cracks.
	•	Add a picking layer (raycast on tile meshes) to query elevation at cursor.

If you want, I can turn this plan into a concrete folder-level implementation blueprint (file list + TypeScript interfaces + key code skeletons for TileLayer, viewState store, tile-to-world math, worker pipeline, and R3F TileMesh).