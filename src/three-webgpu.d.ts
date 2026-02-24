declare module "three/webgpu" {
  export const WebGPURenderer: new (parameters?: Record<string, unknown>) => {
    init?: () => Promise<void>;
  } & import("three").WebGLRenderer;
}
