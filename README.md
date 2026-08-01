# travel.ysoseri.us

一张可长期书写的手绘旅行地图。公开访客从世界总览浏览图钉，管理者在桌面端通过锚定浮窗记录文字、图片和视频。

## 技术栈

- Astro 5、React 19、OpenLayers
- Cloudflare Worker + Workers Static Assets
- D1：图钉、媒体引用、会话、搜索缓存与限流
- R2：羊皮纸瓦片、全站共享媒体与 90 天备份
- 高德 / Google Places 服务端地点搜索

## 本地开发

```powershell
npm install
npm run build
npx wrangler d1 migrations apply travel --local
npx wrangler dev --port 8791
```

本地 Secret 写入 `.dev.vars`，字段参考 `.dev.vars.example`。真实值不得进入 Git。

## 验证

```powershell
npm test
npm run typecheck
npm run build
npm run test:e2e
npx wrangler check startup
npx wrangler deploy --dry-run
```

## 部署

生产配置位于 `wrangler.jsonc`。正式路由为 `travel.ysoseri.us/*`；部署前必须确认 D1 migration、三个 R2 binding 和四个 Worker Secret 均已就绪。
