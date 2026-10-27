# 06 精简定位信息

现行重建入口：在仓库根目录运行 `uv run python -m prototypes.ui.prototype --open`；源码位于 `prototypes/ui/`，指标名称位于 `docs/metric_names.md`，定向检查脚本位于 `scripts/prototype_checks/`。下文旧命令、源码路径及分支说明保留归档分支当时的记录。

Type: task
Status: resolved

## 要求

原型“复制定位信息”包含过多字段，且 `[CMP-LOC]`、`Side`、`Metric`、`Status` 等表达不易理解。精简为便于阅读和定位的文本，同步调整条目内的“复制位置”。

## 实现

- 文件和目录仅复制相对路径，例如 `src/core/parser.c`、`src/expanded`。
- 函数复制中文侧别、路径、起始行与函数名，例如 `当前：src/core/parser.c:287（parse_token）`。优先当前记录，仅基线存在时使用基线记录。
- 危险函数与冗余块采用相同格式，例如 `基线：src/core/parser.c:121（strcpy）`、`当前：src/core/parser.c:302（冗余代码）`。
- 重复片段仅复制侧别和起始位置，例如 `当前：src/core/parser.c:41`。
- 同名函数的对象级文本保留 `src/core/parser.c（parse；同名函数无法配对）`，不选择任意一条行号；具体原始记录仍可分别复制位置。
- 复制文本移除指标值、差值、状态代码、组号、重复长度及技术前缀。这些证据继续在详情内展示。
- 保留定位预览、条目位置复制后的再次复制，以及剪贴板不可用时展开并选中完整文本的行为。

本轮更新原型的显示约定；产品 PRD 的 FR-15 历史完整字段示例未在本轮调整。

## 实际验证

- `uv run python -m cmetrics_cmp_viz.prototype` 构建成功，两侧现有 L0–L3 校验通过。
- `node --check src/cmetrics_cmp_viz/prototype_ui/prototype.js` 与 `git diff --check` 通过。
- 使用 agent-browser 在真实 `file://` 页面验证：文件、目录、普通函数、同名函数、危险函数、冗余块及重复片段的文本。
- 点击文件“复制定位信息”返回“已复制”；复制内容为 `src/core/parser.c`。
- 验证仅基线存在的函数、危险函数及冗余块仍使用“基线”标识。
- 临时拦截剪贴板写入，验证普通/同名函数两侧各记录、重复片段两侧条目的实际复制参数与预览一致；再次复制保留所选片段，切换对象清除片段覆盖。
- 模拟剪贴板拒绝写入，验证文本展开、聚焦、完整选中及手动复制提示。
- 正常页面无浏览器错误。未新增测试套件。

## Answer

原示例现在复制为 `src/core/parser.c`。具体代码位置保留定位所需的版本、路径、行号及必要名称。

- 源码：`src/cmetrics_cmp_viz/prototype_ui/prototype.js`。
- 页面：`output/prototype/cmetrics-prototype.html`。
