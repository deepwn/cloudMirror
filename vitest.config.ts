import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    // Node 环境，WebCrypto 内置可用
    environment: "node",
    // 全局 API（describe/it/expect 无需导入）
    globals: true,
    // 测试文件匹配
    include: ["src/**/*.test.ts"],
    // 每个测试文件独立作用域
    pool: "forks",
    // 超时
    testTimeout: 30_000,
    // setup
    setupFiles: [],
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src/shared"),
      "@worker": path.resolve(__dirname, "src/worker"),
    },
  },
});
