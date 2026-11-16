import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "wiki",
  base: "/wiki/",
  plugins: [react()],
  build: { outDir: "../dist-wiki", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    port: 5177,
    proxy: { "/api": { target: "http://127.0.0.1:3000", changeOrigin: true } },
  },
});
