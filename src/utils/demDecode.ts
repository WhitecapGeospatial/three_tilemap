import type { DemDecodeParams, HeightField } from "../types";

function createCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function decodeRgbDemToHeightField(
  bitmap: ImageBitmap,
  decode: DemDecodeParams,
): HeightField {
  const canvas = createCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d") as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;

  if (!context) {
    throw new Error("Unable to create a 2D context for DEM decoding.");
  }

  context.drawImage(bitmap, 0, 0);
  const imageData = context.getImageData(0, 0, bitmap.width, bitmap.height);
  const out = new Float32Array(bitmap.width * bitmap.height);

  for (let i = 0; i < out.length; i += 1) {
    const idx = i * 4;
    const r = imageData.data[idx];
    const g = imageData.data[idx + 1];
    const b = imageData.data[idx + 2];
    out[i] = decode.base + (r * 256 * 256 + g * 256 + b) * decode.interval;
  }

  return {
    width: bitmap.width,
    height: bitmap.height,
    data: out,
  };
}

export function sampleHeightBilinear(heightField: HeightField, u: number, v: number): number {
  const x = u * (heightField.width - 1);
  const y = v * (heightField.height - 1);

  const x0 = Math.floor(x);
  const x1 = Math.min(heightField.width - 1, x0 + 1);
  const y0 = Math.floor(y);
  const y1 = Math.min(heightField.height - 1, y0 + 1);

  const tx = x - x0;
  const ty = y - y0;

  const i00 = y0 * heightField.width + x0;
  const i10 = y0 * heightField.width + x1;
  const i01 = y1 * heightField.width + x0;
  const i11 = y1 * heightField.width + x1;

  const v00 = heightField.data[i00];
  const v10 = heightField.data[i10];
  const v01 = heightField.data[i01];
  const v11 = heightField.data[i11];

  const top = v00 + (v10 - v00) * tx;
  const bottom = v01 + (v11 - v01) * tx;
  return top + (bottom - top) * ty;
}
