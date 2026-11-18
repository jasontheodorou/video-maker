// Builds the studio app (one page: Make, Videos and Brands) into ui/dist, which the Node server serves.
//   npm run app:build   build once
//   npm run app:dev     live reload on port 5173, with the API passed to the app on port 3006
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const api = `http://localhost:${process.env.PORT || 3006}`;

export default defineConfig({
  root: here,
  base: "/",
  plugins: [react()],
  // Pure engine maths shared with the app: import from "@engine-core/colour-core" or "@engine-core/motion-rules".
  resolve: { alias: { "@engine-core": path.join(here, "..", "engine") } },
  build: {
    outDir: path.join(here, "dist"),
    emptyOutDir: true,
    assetsDir: "assets",
    rollupOptions: {
      input: { index: path.join(here, "index.html") },
    },
  },
  server: {
    proxy: Object.fromEntries(["/api", "/job-files", "/brand-files", "/previews", "/voice-cache", "/static", "/classic"].map((p) => [p, api])),
  },
});
