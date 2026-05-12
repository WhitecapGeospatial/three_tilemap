import { resolve } from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import glsl from "vite-plugin-glsl";
import dts from "vite-plugin-dts";

const peerDeps = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  "three",
  "three/webgpu",
  "three/tsl",
  "@react-three/fiber",
  "@react-three/drei",
  "@deck.gl/core",
  "@deck.gl/react",
  "@deck.gl/geo-layers",
  "@math.gl/web-mercator",
  "zustand",
];

export default defineConfig(({ mode }) => {
  const isLib = mode === "lib";

  return {
    plugins: [
      react(),
      glsl(),
      ...(isLib
        ? [
            dts({
              include: ["src"],
              tsconfigPath: "./tsconfig.app.json",
              compilerOptions: { noEmit: false },
            }),
          ]
        : []),
    ],
    build: isLib
      ? {
          lib: {
            entry: resolve(import.meta.dirname, "src/index.ts"),
            formats: ["es"],
            fileName: "index",
          },
          rollupOptions: {
            external: (id: string) =>
              peerDeps.some((dep) => id === dep || id.startsWith(dep + "/")),
          },
        }
      : undefined,
  };
});
