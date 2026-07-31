# 地图渲染来源

## 行政区划

- 数据集：geoBoundaries `gbOpen`
- API：<https://www.geoboundaries.org/api/current/gbOpen/>
- 用途：ADM0 国级、ADM1 省/州级、ADM2 二级行政区几何
- 许可：各国家/地区来源与许可不同；下载脚本将逐项元数据保存在 `.cache/geoboundaries/attribution.json`
- 注意：ADM2 是“第二级行政区”，不保证在所有国家都等同于“市”

原始 GeoJSON 不提交进仓库，通过 `npm run fetch:data` 按来源重新获取。

世界总览另使用 Natural Earth 1:50m 的 ADM0/ADM1 GeoJSON。它只承担低缩放层级；市县级放大图仍按国家读取 geoBoundaries，因此不会拿低精度轮廓冒充局部细节。Natural Earth 数据为 Public Domain：<https://www.naturalearthdata.com/about/terms-of-use/>。

中国的 geoBoundaries ADM2 实际为县级，不符合本项目要求的“地级市”粒度。因此中国局部样张暂时改用 GADM 4.1 Level 2，共 368 个地级单位，属性中的 `ENGTYPE_2` 可区分 `PrefectureCity` 等类型。GADM 允许非商业用途，禁止未经许可的再分发和商业使用：<https://gadm.org/license.html>。原始数据只保留在忽略提交的缓存中；正式公开瓦片前仍需确认衍生地图的发布边界，或替换成许可更宽松的同等级来源。

## 羊皮纸扫描

- 文件：`assets/parchment-00.jpg`
- 作品：`Parchment.00.jpg`
- 作者：Caleb Kimbrough
- 来源：<https://commons.wikimedia.org/wiki/File:Parchment.00.jpg>
- 原始 Flickr：<https://www.flickr.com/photos/calebkimbrough/4691644631>
- 许可：[CC BY 2.0](https://creativecommons.org/licenses/by/2.0)

该扫描只提供真实纸张纤维与色泽，不含任何地理内容。行政区划墨线由开放几何数据离线渲染后烘焙进纸面。
