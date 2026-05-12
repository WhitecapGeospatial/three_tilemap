import * as THREE from "three";

/**
 * Builds a PlaneGeometry with vertical skirt strips around the perimeter.
 *
 * Skirt vertices duplicate the edge positions/UVs but carry `aSkirt = 1.0`
 * so the shader can pull them downward by a configurable depth. Surface
 * vertices have `aSkirt = 0.0`.
 */
export function createSkirtedPlaneGeometry(
  width: number,
  height: number,
  segments: number,
): THREE.BufferGeometry {
  const plane = new THREE.PlaneGeometry(width, height, segments, segments);
  const srcPos = plane.getAttribute("position") as THREE.BufferAttribute;
  const srcUv = plane.getAttribute("uv") as THREE.BufferAttribute;
  const srcIdx = plane.getIndex()!;

  const cols = segments + 1;
  const rows = segments + 1;
  const surfaceCount = srcPos.count;

  const perimeterIndices = collectPerimeterIndices(cols, rows);
  const skirtCount = perimeterIndices.length;
  const totalVerts = surfaceCount + skirtCount;

  const positions = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);
  const skirtAttr = new Float32Array(totalVerts);

  for (let i = 0; i < surfaceCount; i++) {
    positions[i * 3] = srcPos.getX(i);
    positions[i * 3 + 1] = srcPos.getY(i);
    positions[i * 3 + 2] = srcPos.getZ(i);
    uvs[i * 2] = srcUv.getX(i);
    uvs[i * 2 + 1] = srcUv.getY(i);
    skirtAttr[i] = 0;
  }

  const surfaceToSkirt = new Map<number, number>();
  for (let s = 0; s < skirtCount; s++) {
    const si = perimeterIndices[s];
    const dst = surfaceCount + s;
    positions[dst * 3] = srcPos.getX(si);
    positions[dst * 3 + 1] = srcPos.getY(si);
    positions[dst * 3 + 2] = srcPos.getZ(si);
    uvs[dst * 2] = srcUv.getX(si);
    uvs[dst * 2 + 1] = srcUv.getY(si);
    skirtAttr[dst] = 1;
    surfaceToSkirt.set(si, dst);
  }

  const surfaceIndices: number[] = [];
  for (let i = 0; i < srcIdx.count; i++) {
    surfaceIndices.push(srcIdx.getX(i));
  }

  const skirtIndices = buildSkirtIndices(perimeterIndices, surfaceToSkirt);

  const allIndices = new Uint32Array(surfaceIndices.length + skirtIndices.length);
  allIndices.set(surfaceIndices);
  allIndices.set(skirtIndices, surfaceIndices.length);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute("aSkirt", new THREE.BufferAttribute(skirtAttr, 1));
  geo.setIndex(new THREE.BufferAttribute(allIndices, 1));

  plane.dispose();
  return geo;
}

/**
 * Walk the perimeter of a (cols × rows) grid in order:
 * top edge (left→right), right edge (top→bottom), bottom edge (right→left),
 * left edge (bottom→top). Corners appear only once — at the start of the
 * edge they belong to first.
 */
function collectPerimeterIndices(cols: number, rows: number): number[] {
  const indices: number[] = [];
  const idx = (col: number, row: number) => row * cols + col;

  for (let c = 0; c < cols; c++) indices.push(idx(c, 0));
  for (let r = 1; r < rows; r++) indices.push(idx(cols - 1, r));
  for (let c = cols - 2; c >= 0; c--) indices.push(idx(c, rows - 1));
  for (let r = rows - 2; r >= 1; r--) indices.push(idx(0, r));

  return indices;
}

/**
 * For each consecutive pair of perimeter vertices, emit two triangles
 * connecting the surface edge to the lowered skirt edge.
 */
function buildSkirtIndices(
  perimeter: number[],
  surfaceToSkirt: Map<number, number>,
): number[] {
  const indices: number[] = [];
  const len = perimeter.length;

  for (let i = 0; i < len; i++) {
    const a = perimeter[i];
    const b = perimeter[(i + 1) % len];
    const aSkirt = surfaceToSkirt.get(a)!;
    const bSkirt = surfaceToSkirt.get(b)!;

    indices.push(a, aSkirt, bSkirt);
    indices.push(a, bSkirt, b);
  }

  return indices;
}
