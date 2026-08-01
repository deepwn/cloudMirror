// ============================================================================
// src/worker/html.ts — 前端 SPA 静态文件服务（Cloudflare Assets Binding）
// ============================================================================
// 使用 Cloudflare Workers Static Assets + @cloudflare/vite-plugin
// Vite 构建产物由插件管理，Worker 通过 env.ASSETS.fetch() 分发
// DEV 模式: vite dev 一键启动 React HMR + Worker (workerd)
// 部署: vite build && wrangler deploy
// ============================================================================

export function serveHtml(request: Request, assets: Fetcher): Promise<Response> {
  return assets.fetch(request);
}
