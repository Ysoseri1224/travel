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

## 16K 纯纸面超分

`notebooks/paper-superres-colab.ipynb` 用于在 Colab GPU 中把调试输出的纯纸面 `.cache/debug/world-paper.png` 从 8192×4096 放大到 16384×8192。它不会处理已经包含行政墨线的最终成品：RealESRGAN_x2plus 只提供高频残差，宏观色调、氧化、折痕、污渍和透明撕边仍以原始纸面为准。

notebook 会同时输出回缩 8K 后的 MAE、PSNR、SSIM、低频色差、alpha 误差和局部对比图。自动门槛通过只代表宏观一致性合格，不能替代 z9-z10 实际拖拽时的重复感与接缝检查。

## 纸张覆盖层素材

生成便利贴与相纸透明母版：

```powershell
npm run render:props
```

输出写入 `../assets/paper-props/v1/`，包括 PNG 母版、运行时 WebP、内容窗口 manifest 和总览预览。命令结束前会自动验证尺寸、alpha 通道、透明内容窗与安全区。

## 当前边界

- 这是制图与材质方向样张，不是最终 Deep Zoom 瓦片金字塔。
- 世界总览使用 Natural Earth 1:50m；局部层按国家读取更细数据，避免低缩放时解析全球五万多个二级行政区。
- 当前撕裂边缘是确定性烘焙蒙版，仍需要更真实的扫描边缘资产替换。
- 尚未加入地名文字；语言、密度和层级需要单独确定。
- 中国地级层暂用 GADM 4.1，仅用于非商业原型；公开发布前需要确认衍生地图许可或替换数据源。

完整数据与纸张归属见 [SOURCES.md](./SOURCES.md)。
