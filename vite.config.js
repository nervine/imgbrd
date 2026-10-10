import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: path.resolve("client"),
  base: "./",
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    fs: { allow: [path.resolve(".")] },
    proxy: {
      "/api": "http://127.0.0.1:4178",
    },
  },
  build: {
    outDir: path.resolve("dist"),
    emptyOutDir: true,
  },
});
