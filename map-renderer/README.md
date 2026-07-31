# Travel 地图离线渲染器

把精确行政区划骨架与真实羊皮纸扫描离线合成，输出供视觉评审的世界总览与局部放大样张。浏览器端不需要地图平台 token，也不会实时运行 Rough.js 或 Canvas 来伪造底图。

## 运行

```powershell
npm install
npm run fetch:data
npm run render:preview
```

输出位于 `output/`：

- `world-parchment-v1.webp`：8192×4096 世界总览，显示 ADM0/ADM1
- `china-east-parchment-v1.webp`：4096×3072 中国东部，显示省级与 368 个地级单位中的可见部分
- `new-zealand-parchment-v1.webp`：4096×3072 新西兰，显示区域与 Territorial Authorities

可以用环境变量只渲染一张：

```powershell
$env:MAP_RENDER_ONLY='world'
npm run render:preview
```

`MAP_RENDER_DEBUG=1` 会把纸张蒙版、陆地蒙版和各级墨线层写入 `.cache/debug/`，用于排查合成故障。

## 当前边界

- 这是制图与材质方向样张，不是最终 Deep Zoom 瓦片金字塔。
- 世界总览使用 Natural Earth 1:50m；局部层按国家读取更细数据，避免低缩放时解析全球五万多个二级行政区。
- 当前撕裂边缘是确定性烘焙蒙版，仍需要更真实的扫描边缘资产替换。
- 尚未加入地名文字；语言、密度和层级需要单独确定。
- 中国地级层暂用 GADM 4.1，仅用于非商业原型；公开发布前需要确认衍生地图许可或替换数据源。

完整数据与纸张归属见 [SOURCES.md](./SOURCES.md)。
