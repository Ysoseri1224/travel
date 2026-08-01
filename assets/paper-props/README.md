# Travel 纸张覆盖层素材

用于地图图钉附属内容的透明纸张母版。素材由 `map-renderer/assets/parchment-00.jpg` 程序化派生，与底图保持同一纸张色温和纤维语言，不依赖生成模型。

## 生成

```powershell
cd map-renderer
npm run render:props
```

成品写入 `v1/`：

- `note-warm-square-v1`：暖赭黄色便利贴，纯文字
- `photo-classic-v1`：正方形内容窗，较宽的下方说明区
- `photo-landscape-v1`：横向内容窗
- `photo-portrait-v1`：纵向内容窗

每项同时提供无损 PNG 母版和站点运行时 WebP。相纸内容窗是真实透明区域，具体像素范围及便利贴文字安全区见 `v1/manifest.json`。

阴影、旋转、图钉和 hover 抬起不烘焙进位图，由前端按交互状态实时渲染。
