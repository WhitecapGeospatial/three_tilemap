uniform sampler2D uImageryTexture;

varying vec2 vUv;

void main() {
  gl_FragColor = texture2D(uImageryTexture, vUv);
  #include <colorspace_fragment>
}
