/// <reference types="vite/client" />
/// <reference types="vite-plugin-glsl/ext" />

declare module "*?worker&inline" {
  const WorkerConstructor: new () => Worker;
  export default WorkerConstructor;
}

// @types/three v0.180.0 exposes node material classes through multi-level
// `export * from "./foo.js"` chains, which TypeScript resolves as types but
// not as constructable values.  Explicitly re-declare the ones we use here.
declare module "three/webgpu" {
  import type { NodeMaterial } from "three/webgpu";
  export const MeshBasicNodeMaterial: {
    new (parameters?: Partial<{ side: number; transparent: boolean; alphaTest: number }>): NodeMaterial & {
      positionNode: import("three/tsl").ShaderNodeObject<import("three/tsl").Node> | null;
      colorNode: import("three/tsl").ShaderNodeObject<import("three/tsl").Node> | null;
    };
  };
}
