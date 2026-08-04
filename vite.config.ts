import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  resolve: {
    alias: {
      "@shared": resolve(rootDir, "src/shared"),
      "@": resolve(rootDir, "src"),
    },
  },
  server: {
    // 本地允许 {hash}.{APP_DOMAIN} 通配子域（capture/子域代理调试）
    allowedHosts: [".mirror.deepwn.io", ".mirror.example.com", "localhost", "127.0.0.1"],
  },
});
