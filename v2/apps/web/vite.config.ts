import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
export default defineConfig({
  root: path.resolve("apps/web"),
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5273,
    strictPort: true,
    allowedHosts: ["127.0.0.1"],
    proxy: { "/api": { target: "http://127.0.0.1:8788", changeOrigin: true } },
  },
  build: { outDir: "../../dist/web", emptyOutDir: true },
});
