// Builds the web app's pages (Make a video and Brands) into ui/dist, which the Node server serves.
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
  build: {
    outDir: path.join(here, "dist"),
    emptyOutDir: true,
    assetsDir: "assets",
    rollupOptions: {
      input: { index: path.join(here, "index.html"), brands: path.join(here, "brands.html") },
    },
  },
  server: {
    proxy: Object.fromEntries(["/api", "/job-files", "/brand-files", "/previews", "/voice-cache", "/static", "/classic"].map((p) => [p, api])),
  },
});
