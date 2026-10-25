# Cmetrics 官方规格证据核查

## 来源与边界

仅核查用户指定的公开一手来源：[华为云《Cmetrics工具规格说明》](https://support.huaweicloud.com/intl/zh-cn/api-codecheck/codecheck_03_0016.html)（下称 S）。未读取公司文件，未核验内部二进制、实际输出或配置，未修改 `docs/FSR.md`、`sample.json`，未实现功能。

证据来自完整 HTML 抓取记录 `mvhapg98jfwmzl`，通过 `get_search_content` 核查正文、更新时间和表2；另以 readable 抓取记录 `mvhaqwg3tk9ang` 逐项核对表1。readable 本次仅返回表1，不能据此断言页面没有工具介绍、默认阈值等内容。独立 curl 未取得可解析正文，未用其作证据。

## 1. 更新时间、版本、默认阈值与比较边界

S 页面实际显示 **“更新时间：2026-10-15 GMT+08:00”**；工具介绍写 **“当前工具版本为2.1.5。”** 此处仅转录页面显示值，不把页面更新时间当作二进制发布日期，也不据此确认项目内部版本是 2.1.5。

[表2“Cmetrics工具默认阈值”](https://support.huaweicloud.com/intl/zh-cn/api-codecheck/codecheck_03_0016.html#codecheck_03_0016__table862112912190) 只有“阈值名称”“默认值”两列：

| 官方阈值名称 | 默认值 |
| --- | ---: |
| 超大圈复杂度函数-圈复杂度阈值 | 20 |
| 超大深度数函数-深度阈值 | 4 |
| 超大函数-行数阈值 | 50 |
| 超大头文件-行数阈值 | 500 |
| 超大源文件-行数阈值 | 2000 |
| 超大目录数-节点阈值 | 50 |

[表1](https://support.huaweicloud.com/intl/zh-cn/api-codecheck/codecheck_03_0016.html#codecheck_03_0016__table2562111915612) 原文：“统计圈复杂度大于阈值的函数个数。其中阈值由Cmetrics工具版本决定”；其他超大项也使用“大于”。因此是 **严格 `>`，不是 `>=`**。超大头文件、源文件按非空非注释代码行；超大目录按直接文件和子目录数量，原文排除更深层节点及空子目录。

**版本差异的证据边界：** 官方明确阈值受工具版本影响，但此页没有逐版本对照表，不能据此生成旧版/新版阈值差异。表2没有单列“cca圈复杂度阈值”；`huge_cca_cyclomatic_complexity_total` 虽写“大于阈值”“阈值由Cmetrics工具版本决定”，但不能把普通圈复杂度的 20 无条件认证为独立 CCA 阈值。

## 2. 不是 JSON 输出契约

S 的表1列名是“参数”“说明”，给出 43 个英文指标名、语义、公式及若干启用/语言条件；表2给出中文阈值名和数值。**此页没有给出 `summary_metrics` JSON 容器、JSON 示例或 schema，也没有给出这些指标的 JSON 数据类型、必填/可缺省规则、null 约定、数值精度，或工具版本字段和阈值字段的机器字段名。** 页面正文的“当前工具版本为2.1.5”不是输出中存在版本字段的证据。

所以可以引用此页解释指标，但不能声称它证明内部输出是某个 JSON 结构、值必为 number（而不是数值字符串）、输出必含版本/阈值元数据。以上否定范围仅限本页，不等于已查遍所有公开接口文档。

## 3. 官方可配置说明与项目内部不可配置并不冲突

表1的普通圈复杂度、CCA圈复杂度、深度、函数行数、源文件行数、目录节点超大项写有 **“部分语言可通过Cmetrics规则修改”**；超大头文件项没有这句话。页面没有在这里列出具体哪些语言可改，也没有保证所有部署提供这种能力。

另有 `warning_suppression_total` 和 `warning_suppression_kloc` 的 **“该参数需启用Cmetrics规则后生效。”** 这是指标生效条件，不等于内部工具一定提供规则编辑入口。[证据：S 表1]

应分别记录：

- **公开产品文档事实：** 部分语言、通过 Cmetrics 规则可修改部分阈值。
- **用户给定的内部环境约束：** 本项目使用的内部工具不可配置。该约束来自用户，不是本页结论；本次未独立核验。
- 不应把用户环境约束改写成“官方所有 Cmetrics 均不可配置”，也不应拿公开产品能力反驳用户所述内部封装/部署限制。内部版本、有效阈值和实际输出均仍需内部环境另行确认；本次不读取内部材料。

## 4. 公式歧义与趋势方向

### 两处百分数公式缺少 `*100`

表1原文：

> `huge_depth_ratio`：“超大深度占比=超大深度数/函数总数（单位：百分比%）”
>
> `non_hfile_code_duplication_ratio`：“源文件代码重复率=源文件代码重复数/代码行总数（单位：百分比%）”

同表的 `huge_method_ratio`、`code_duplication_ratio` 等公式则明确写 `*100`。**能确定的是文本存在表达不一致；不能确定是公式漏写 `*100`，还是实际输出采用 0–1 比例，亦不能确定内部输出单位。** 不应仅根据 `%` 或指标后缀自动乘除100。第二个公式的原文分母是“代码行总数”，不是“源文件代码行总数”；不能自行替换。[证据：S 表1]

### `<1000` 特殊处理只明确附在冗余密度项

表1 `unsafe_functions_kloc` 只有：

> “危险函数密度=危险函数总数/代码行总数*1000”

`redundant_code_kloc` 写：

> “冗余代码块密度=冗余代码数/代码行总数*1000”
>
> “如果代码行总数少于1000，不计算密度，取值为0。”

完整 HTML 中，这条“说明”嵌套在 **`redundant_code_kloc` 所在单元格**，不是全表公共说明。因此文档明确支持冗余密度 `<1000 → 0`，**没有足够证据将其推广至危险函数密度或抑制告警密度**。也不能由此反推内部 unsafe 必然不做特殊处理。这里“少于”是 `<1000`，不是 `<=1000`；页内未提供通用零分母规则。[证据：S 表1]

### CCA 满足度增大不是恶化

`cyclomatic_complexity_adequacy` 原文：

> “圈复杂度满足度=((函数总数-超大cca圈复杂度函数总数) / 函数总数)*100（单位：百分比%）”
>
> “cyclomatic complexity adequacy的缩写即为cca。”

**公式推论（不是页面直接规定的 UI 颜色策略）：** 在分母非零、版本/阈值及统计口径可比时，满足度越高表示超大 CCA 函数占比越低，方向与“增长即恶化”相反。不能把该指标与 CCA 复杂度总数/均值混同，也不能把所有指标统一判为增长恶化。函数总数等规模指标的增大本身亦不能仅凭此页判为质量恶化。[证据：S 表1]

## 5. 表1字段名核对：确为 43 项

以下按表1顺序转录；只是官方参数名清单，不认证它们属于实际 JSON 的 `summary_metrics`。来源：[S 表1](https://support.huaweicloud.com/intl/zh-cn/api-codecheck/codecheck_03_0016.html#codecheck_03_0016__table2562111915612)。

| 序号 | 参数名 |
| ---: | --- |
| 1 | `code_size` |
| 2 | `raw_lines` |
| 3 | `methods_total` |
| 4 | `cyclomatic_complexity_total` |
| 5 | `cyclomatic_complexity_per_method` |
| 6 | `maximum_cyclomatic_complexity` |
| 7 | `huge_cyclomatic_complexity_total` |
| 8 | `huge_cyclomatic_complexity_ratio` |
| 9 | `cca_cyclomatic_complexity_total` |
| 10 | `cca_cyclomatic_complexity_per_method` |
| 11 | `maximum_cca_cyclomatic_complexity` |
| 12 | `huge_cca_cyclomatic_complexity_total` |
| 13 | `cyclomatic_complexity_adequacy` |
| 14 | `maximum_depth` |
| 15 | `huge_depth_total` |
| 16 | `huge_depth_ratio` |
| 17 | `method_lines` |
| 18 | `lines_per_method` |
| 19 | `huge_method_total` |
| 20 | `huge_method_ratio` |
| 21 | `files_total` |
| 22 | `folders_total` |
| 23 | `lines_per_file` |
| 24 | `huge_headerfile_total` |
| 25 | `huge_headerfile_ratio` |
| 26 | `huge_non_headerfile_total` |
| 27 | `huge_non_headerfile_ratio` |
| 28 | `huge_folder_total` |
| 29 | `huge_folder_ratio` |
| 30 | `file_duplication_total` |
| 31 | `file_duplication_ratio` |
| 32 | `non_hfile_duplication_total` |
| 33 | `non_hfile_duplication_ratio` |
| 34 | `code_duplication_total` |
| 35 | `code_duplication_ratio` |
| 36 | `non_hfile_code_duplication_total` |
| 37 | `non_hfile_code_duplication_ratio` |
| 38 | `unsafe_functions_total` |
| 39 | `unsafe_functions_kloc` |
| 40 | `redundant_code_total` |
| 41 | `redundant_code_kloc` |
| 42 | `warning_suppression_total` |
| 43 | `warning_suppression_kloc` |
