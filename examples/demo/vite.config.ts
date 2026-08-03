import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // The linked package is a file: dependency; don't pre-bundle its subpaths stale.
  optimizeDeps: { exclude: ["@minato-32/statement-notify"] },
});
