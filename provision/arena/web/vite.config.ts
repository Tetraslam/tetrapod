import { defineConfig } from "vite";

// `vite dev` proxies the live arena, so the UI can be worked on against real matches.
const live = process.env.ARENA_ORIGIN || "https://arena.tetraslam.world";

export default defineConfig({
  build: { outDir: "dist", emptyOutDir: true, target: "es2022" },
  server: {
    proxy: {
      "/api": { target: live, changeOrigin: true },
      "/sprites": { target: live, changeOrigin: true },
      "/ws": { target: live, changeOrigin: true, ws: true },
    },
  },
});
