import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const staticBuild = process.env.VITE_STATIC_DATA === "true" || process.env.GITHUB_PAGES === "true";

export default defineConfig({
  plugins: [react()],
  base: staticBuild ? "./" : "/",
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4000"
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
