# CutBox desktop UI design

Primary concept: [generated concept](design/concept.png) (1505 × 1045). Generated and inspected before implementation. No supplied media means genuine empty state, never seeded film data.

## Tokens and inventory

Charcoal background #161819; sidebar #121415; surface #202325; border #34383b; text #efefed; muted #a4a7ab; warm amber #d4aa68. Flat surfaces, 7px control radius, 1px borders, no gradients. System sans-serif with PingFang SC / Microsoft YaHei; 28px page headings, 14px controls, 13px secondary text. Lucide outline icons, 18–20px and 1.7 stroke.

The primary viewport has a 220px navigation rail, a page header, search/filter toolbar, spacious dashed empty state, three-step workflow, and storage footer. Navigation: 素材库 / 资产 / 标注工作台 / 拉片 / 素材集合 / 任务中心. Primary copy: 每一帧，都有值得留下的信息。/ 从第一份素材开始 / 导入视频、音频或图片，建立你的本地素材库。/ 选择本地文件 / 原始文件保持不变 · 仅建立本地引用. Header actions 导入素材 and 导入素材包.

Required downstream screens extend the same tokens: media grid/list, semantic entity cards and edit dialog, player + annotation inspector, collection member picker, package-password dialog, and job rows. No decorative raster assets; only imported user media appears in media previews. Native window chrome is supplied by Electron, not imitated in HTML. Smaller screens collapse navigation labels, wrap toolbars, and stack editor panes. Dialogs are bounded and scrollable with keyboard focus containment.

## Validation

Browser/IAB tools unavailable in current tool inventory; Electron Playwright is used for runtime screenshots and workflows. Fidelity comparison results to be appended after integration.

Intentional evidence-based copy correction: normal media import references original files, so the generated concept copy claiming copies has been corrected to “原始文件保持不变 · 仅建立本地引用”.

## Fidelity ledger (implementation review)

Playwright launched the real Electron application under Xvfb with an isolated empty data directory. Captured native concept dimensions **1505 × 1045** and compact **700 × 900**. Used `view_image` on the generated concept and latest [desktop capture](design/desktop.png) in the same review, plus asset edit modal the temporary asset-dialog capture and compact the temporary compact capture.

| Comparison | Evidence and resolution |
| --- | --- |
| Shell geometry | Initial 220px sidebar was underscaled against the concept. Wide-desktop rail is now 256px; main gutter 45px; reference-aligned navigation rhythm. |
| Main composition | Empty-state box now 840 × 480, centered under the search/filter row; three-step strip and storage footer retained. No film placeholders or fabricated metrics. |
| Typography | Wide layout increased page heading to 36px, navigation to 17px, empty heading to 26px and primary controls to 16–17px. System Chinese font differences across Linux/macOS remain expected. |
| Palette and controls | Charcoal background, dark rail, warm amber primary controls, understated borders and outline icons match the reference. Raster noise / image-generator button texture intentionally not reproduced in native controls. |
| Above-fold copy | Navigation, main heading, description, search/filter labels and primary CTA match. Intentional correction: original-media reference copy replaces the concept's false copy claim. |
| Icon semantics | Film brand/empty state, folder library/collection, database assets, edit annotation, storage and grid/list controls retained. Clapperboard for Study and list-check for Jobs are precise Lucide workflow equivalents. |
| Responsive continuation | Compact layout collapses the rail labels, wraps header and search, retains all actions and avoids horizontal clipping. The form dialog remains bounded and scrollable. |
| Native surface | Window control buttons are provided by Electron/OS; screenshot crops to renderer. No fake Windows chrome is drawn. |

The implementation has been visually verified against the design reference; no remaining material layout or readability mismatch was observed in these screens. Full functional integration tests are independently reported in [validation](VALIDATION.md); this visual check is not a substitute for those tests. This review exercised navigation, create-asset dialog opening/cancel and compact layout. Reference screenshots are temporary QA artifacts outside the checkout; retain selected delivery screenshots separately when documenting the release.
