import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    react: "src/react.ts",
    adapters: "src/adapters.ts",
    testing: "src/testing.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  splitting: false,
  // Everything the package composes over is a peer — never bundle it.
  external: [
    "react",
    "@parity/product-sdk-statement-store",
    "@parity/product-sdk-local-storage",
    "@parity/product-sdk-host",
  ],
});
