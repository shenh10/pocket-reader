import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const staticBuild = process.env.GITHUB_PAGES === "true";

export default defineConfig({
  plugins: [react()],
  base: staticBuild ? "./" : "/",
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true
      }
    }
  },
  preview: {
    host: "127.0.0.1",
    port: 4173
  }
});
