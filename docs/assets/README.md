# 宣传页图片来源

- `lifestyle.webp`：下述原图直接编码为 WebP（质量 85），画面未修改，网页实际使用约 67 KiB 版本。
- `app-icon.png`：复用仓库 iOS AppIcon，缩放至 128 × 128，未另造品牌标识。
- `app-print.png`、`app-chat.png`：当前 Web 应用在 Chrome 中的真实界面截图，390 × 844 CSS 像素、2 倍栅格。使用隔离模拟服务与演示数据；聊天用户提问由测试命令替换为合成提问，回复、卡片、字体、控件和布局未改。未连接设备、未实际打印，不能视为真机照片或真实模型效果验证。
- 原始 PNG 与本说明不进入 GitHub Pages 发布包；页面展示图片均由本仓库托管，无外部图片依赖。

## lifestyle.png

- 来源：OpenAI 内置 `image_gen` 工具生成，2026-10-13。
- 用途：词签宣传页的生活场景概念配图。
- 性质：AI 生成图片，不是产品、设备或真实打印效果的实拍照片。
- 原始尺寸：1536 × 1024 像素，横向 3:2。
- 已检查：右侧蓝色陶瓷杯、浅色厨房与自然日光；无文字、标签、手机、打印机、商标、水印或人物。
- 未对生成结果修改画面。

准确生成提示词：

```text
Use case: photorealistic-natural
Asset type: landing page hero lifestyle concept image for an English-learning label app
Primary request: a realistic editorial photograph of a bright, simple modern kitchen / breakfast table in cool off-white, with a cobalt-blue ceramic coffee mug prominently placed on the right side of the foreground table. A simple unbranded white refrigerator or white cabinets and a small green potted plant appear softly behind.
Composition/framing: horizontal 3:2 landscape photograph, approximately 1536x1024; a quiet uncluttered tabletop across the lower foreground, the blue mug on the right third, calm open space on the left; natural eye-level-to-table perspective.
Lighting/mood: soft natural daylight, calm everyday home atmosphere, airy but tangible, believable shadows.
Color palette: cool off-white surfaces, restrained cobalt blue mug, small natural green plant.
Materials/textures: realistic glazed ceramic, subtly textured tabletop and painted cabinetry. Editorial lifestyle photography, not a render.
Constraints: This is a generic lifestyle concept image, not a photograph of the app or its hardware. No text, letters, words, labels, label stickers, phones, printers, screens, logos, watermarks, human hands, people, collages, frames, or graphical overlays. Do not place anything resembling a label on any object.
```
