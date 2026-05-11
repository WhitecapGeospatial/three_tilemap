/**
 * Standalone verification of resolveUVBounds mapping math.
 * Run: pnpm dlx tsx src/terrain/resolveUVBounds.verify.ts
 */
import { resolveUVBounds } from "./resolveUVBounds";
import type { UVBounds } from "./types";

const UV_INSET = 0.25;
let passed = 0;
let failed = 0;

function approxEqual(a: number, b: number, eps = 1e-12): boolean {
  return Math.abs(a - b) < eps;
}

function assertBounds(label: string, actual: UVBounds, expected: UVBounds) {
  const ok =
    approxEqual(actual.uMin, expected.uMin) &&
    approxEqual(actual.uMax, expected.uMax) &&
    approxEqual(actual.vMin, expected.vMin) &&
    approxEqual(actual.vMax, expected.vMax);
  if (ok) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${label}`);
    console.error(`  expected: ${JSON.stringify(expected)}`);
    console.error(`  actual:   ${JSON.stringify(actual)}`);
  }
}

// --- scale=1: single tile maps to full UV range ---
assertBounds("scale=1 identity",
  resolveUVBounds(0, 0, 1),
  { uMin: 0, uMax: 1, vMin: 0, vMax: 1 },
);

// --- scale=2: four children tile the [0,1]² UV space ---
assertBounds("scale=2 NW (localX=0, localY=0)",
  resolveUVBounds(0, 0, 2),
  { uMin: 0, uMax: 0.5, vMin: 0.5, vMax: 1 },
);
assertBounds("scale=2 NE (localX=1, localY=0)",
  resolveUVBounds(1, 0, 2),
  { uMin: 0.5, uMax: 1, vMin: 0.5, vMax: 1 },
);
assertBounds("scale=2 SW (localX=0, localY=1)",
  resolveUVBounds(0, 1, 2),
  { uMin: 0, uMax: 0.5, vMin: 0, vMax: 0.5 },
);
assertBounds("scale=2 SE (localX=1, localY=1)",
  resolveUVBounds(1, 1, 2),
  { uMin: 0.5, uMax: 1, vMin: 0, vMax: 0.5 },
);

// --- scale=4: spot-check one child ---
assertBounds("scale=4 (localX=2, localY=1)",
  resolveUVBounds(2, 1, 4),
  { uMin: 0.5, uMax: 0.75, vMin: 0.5, vMax: 0.75 },
);

// --- Adjacency: east neighbors share a U boundary ---
{
  const west = resolveUVBounds(0, 0, 2);
  const east = resolveUVBounds(1, 0, 2);
  const ok = approxEqual(west.uMax, east.uMin);
  if (ok) { passed++; } else {
    failed++;
    console.error(`FAIL: east adjacency — west.uMax=${west.uMax}, east.uMin=${east.uMin}`);
  }
}

// --- Adjacency: south neighbors share a V boundary ---
{
  const north = resolveUVBounds(0, 0, 2);
  const south = resolveUVBounds(0, 1, 2);
  const ok = approxEqual(north.vMin, south.vMax);
  if (ok) { passed++; } else {
    failed++;
    console.error(`FAIL: south adjacency — north.vMin=${north.vMin}, south.vMax=${south.vMax}`);
  }
}

// --- Coverage: children tile the full UV space without gaps or overlaps ---
for (const scale of [2, 4, 8]) {
  let uCoverage = 0;
  let vCoverage = 0;
  for (let lx = 0; lx < scale; lx++) {
    const b = resolveUVBounds(lx, 0, scale);
    uCoverage += b.uMax - b.uMin;
  }
  for (let ly = 0; ly < scale; ly++) {
    const b = resolveUVBounds(0, ly, scale);
    vCoverage += b.vMax - b.vMin;
  }
  const ok = approxEqual(uCoverage, 1) && approxEqual(vCoverage, 1);
  if (ok) { passed++; } else {
    failed++;
    console.error(`FAIL: coverage at scale=${scale} — uCoverage=${uCoverage}, vCoverage=${vCoverage}`);
  }
}

// --- Core inset within UV window should not exceed parent texture ---
for (const scale of [1, 2, 4]) {
  for (let lx = 0; lx < scale; lx++) {
    for (let ly = 0; ly < scale; ly++) {
      const b = resolveUVBounds(lx, ly, scale);
      const uSize = b.uMax - b.uMin;
      const vSize = b.vMax - b.vMin;
      const coreUMin = b.uMin + uSize * UV_INSET;
      const coreUMax = b.uMax - uSize * UV_INSET;
      const coreVMin = b.vMin + vSize * UV_INSET;
      const coreVMax = b.vMax - vSize * UV_INSET;
      const ok = coreUMin >= -1e-12 && coreUMax <= 1 + 1e-12 &&
                 coreVMin >= -1e-12 && coreVMax <= 1 + 1e-12 &&
                 coreUMin < coreUMax && coreVMin < coreVMax;
      if (ok) { passed++; } else {
        failed++;
        console.error(`FAIL: core inset bounds at scale=${scale} (${lx},${ly})`);
      }
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
