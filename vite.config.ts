import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const API_PORT = Number(process.env.DI_DEV_API_PORT ?? 7777);

export default defineConfig({
  plugins: [react()],
  build: {
    // CLI から静的配信するので dist/web にまとめる
    outDir: "dist/web",
    emptyOutDir: true,
    target: "esnext",
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${API_PORT}`,
        changeOrigin: true,
      },
    },
  },
});
