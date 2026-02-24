// GPU terrain vertex shader
//
// Decodes the RGB-encoded DEM texture directly on the GPU and displaces each
// vertex in Z.
//
// RGB terrain encoding (Mapbox / Terrarium-style):
//   elevation = base + (R * 256² + G * 256 + B) * interval
// where R, G, B are the raw 0-255 byte values stored in the PNG.
//
// GLSL texture2D returns normalised [0,1] values, so we multiply each channel
// by 255 to recover the original byte value before applying the formula.
//
// The DEM texture is uploaded with flipY=true, so UV (0,0) is the south edge
// and UV (1,1) is the north edge — matching the PlaneGeometry UV layout.

uniform sampler2D uDemTexture;
uniform float uBase;
uniform float uInterval;
uniform float uHeightScaleFactor;  // heightScale * worldUnitsPerMeter
uniform float uFlattenTerrain;     // 1.0 = flatten to z=0, 0.0 = normal

varying vec2 vUv;

float decodeElevation(vec2 uvSample) {
  vec4 c = texture2D(uDemTexture, uvSample);
  // Multiply by 255 to convert normalised [0,1] back to byte values [0,255].
  return uBase + 255.0 * (c.r * 65536.0 + c.g * 256.0 + c.b) * uInterval;
}

void main() {
  vUv = uv;
  float elev = uFlattenTerrain > 0.5 ? 0.0 : decodeElevation(uv);
  float z = elev * uHeightScaleFactor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position.x, position.y, z, 1.0);
}
