# Cmetrics 模拟扫描数据生成指导

- 状态：P0 实施完成，包含口径规范、CLI 生成脚本与 L0–L3 自动化校验体系
- 结构契约：[schemas/cmetrics-report.schema.json](../schemas/cmetrics-report.schema.json)（JSON Schema Draft 2020-12，模拟 profile v1）
- 依据：[docs/FSR.md](FSR.md) §2–4、§6.3、§8.1–8.3；交接记录 `.scratch/cmetrics-schema-handoff-ruawuff6.md`；本轮用户确认 Q1–Q8
- 优先级：本文及 Schema 采用的用户确认口径优先于 FSR 中较早的“待确认”表述；历史结构样例见 `d1ebe80:sample.json`（仓库根目录执行 `git show d1ebe80:sample.json`）
- 交付成果：已完成基于 `msgspec` 与 `jsonschema` 的独立生成脚本与校验器，提供 CLI 命令行工具 `cmetrics_cmp_viz.cli`，具体使用见第 11 节。

## 1. 范围与定位

- 目标：指导后续生成器产出**可从明细复算汇总**的 baseline/current 模拟扫描 JSON，作为正确性夹具与容量压力数据来源。
- Schema 定位：当前模拟 profile v1 的**结构**契约。它不是 Cmetrics 所有版本的官方输出契约，不是 `cmp_*` 对比结果契约，也不能证明统计一致性。
- 两侧可选代码元信息（仓库、分支、节点、版本号）由对比工具使用者手工提供，不属于扫描 JSON，不在本契约内（FSR §3.4）。
- 历史 `sample.json`（`d1ebe80:sample.json`，已从现行目录移除）是结构样例：即使通过 L1 结构校验，也只证明结构合规；其汇总与明细存在有意的不一致，不得用作 L2 正例。

## 2. 校验分层

| 层 | 执行时机 | 职责 | 明确不能证明 |
|---|---|---|---|
| L0 JSON 解析 | 读入时 | 合法 JSON；无重复对象键；无 `NaN`/`Infinity` 等非标准数值 | 任何 Schema 约束（重复键等在解析层已丢失） |
| L1 Schema（Draft 2020-12） | 读入后 | 类型、必填、容器形态、`method_metrics` 中最大值对象**恰一个**、路径与行号格式、百分比范围 | 最大值对象位于末尾；实际最大值；引用完整性；汇总公式；阈值派生 |
| L2 语义校验（仅凭 JSON） | 适配前 | §4 公式复算；引用完整性行号范围；`huge_folders` 复算；尾对象位置与取值；扫描命令解析 | 有效重复行并集的**事实**（见 §5.4：仅凭输出字段通常无法重建覆盖集合） |
| L3 生成端内部模型 | 生成器内部 | 有效行与重复覆盖一致性；函数行来源；变化台账与预期差值；种子复现 | 不适用于外部输入，只约束生成产物 |

关键分层示例：`[最大值对象, 普通函数]` 通过 L1（对象唯一、形态合法），L2 必须拒绝（尾位约束）。Schema 采用 `contains` + `minContains/maxContains: 1` 只能保证数量，不引入自定义关键字或函数数量上限去模拟尾位约束。

## 3. 模拟口径（用户已确认）

以下口径对本 profile 生效，均已在 Schema 描述或本节固定；其中标注“合成约定”的条目是本项目为生成可复算数据而设，**不代表真实扫描器已核验的行为**。

### 3.1 抑制告警字段

- `warning_suppression_total` 与 `warning_suppression_kloc` **均不生成、不分析、不参与统计一致性校验**，也不以 `0` 代替省略。
- Schema 将两者列为可选字段仅为兼容现有样例输入；模拟输出一律省略。

### 3.2 行号

- 行号从 **1** 开始；普通函数 `end_line` **包含末行**。
- 函数非空非注释代码行 `nbnc_loc` 排除函数开头定义行，不等于物理跨度 `end_line - start_line + 1`。
- 重复片段只输出 `start_line` 与长度 `code_duplication`；**不生成** `end_line`（输入侧该字段可选兼容），不以 `start_line + 长度 - 1` 反算物理结束行。

### 3.3 数值尺度与精度

- 百分比一律使用百分数尺度：`5.0` 表示 `5%`，范围 0–100；包括存在官方文档歧义的 `non_hfile_code_duplication_ratio`（本条为模拟约定，真实内部尺度未核验）。
- 每千行密度按“数量 ÷ `code_size` × 1000”，不是百分比，不受 0–100 限制。
- 数量、总量、最大值为非负整数；均值、百分率、密度先用未舍入的整数比计算。所有对外业务浮点数（含均值、百分率、密度及 `_kloc`、差值和净影响）统一按十进制 Half-Up 四舍五入至两位小数，不能截断；内部保留未舍入分子／分母及精确值用于计算、比较、分类、筛选、排序和聚合，不能用显示舍入值分类。允许显示分项之和与显示总量存在舍入尾差。JSON number 保存数值，界面负责补齐两位尾零。
- 十进制 Half-Up 舍入实现与一致性比较策略在生成与校验两侧必须相同，随技术选型一次性固定。

### 3.4 零分母与特殊密度规则

- 分母为 0 的均值、比例、密度按合成约定输出 `0`；这只是空集合约定，不证明真实扫描器如此输出。专门空集合夹具负责覆盖该场景，普通非空数据严格按公式生成。
- `code_size < 1000 → 0` 的特殊规则**仅适用于 `redundant_code_kloc`**；`code_size = 1000` 必须计算；不得推广到 `unsafe_functions_kloc`。

### 3.5 语言、后缀、路径与扫描命令

- 语言固定 `clike`（C/C++）。头文件后缀 `.h` `.hh` `.hpp` `.hxx`；源文件后缀 `.c` `.cc` `.cpp` `.cxx`。
- 路径为 POSIX 绝对路径，不含逗号、引号、控制字符；无 `.`/`..` 段、无重复斜杠（合成命令直接生成规范形式）。
- `command` 为完整扫描命令元信息，**只解析、永不执行**。支持范围：恰一个 `-fp` 参数，其值为一个或多个以逗号分隔的绝对目录；须含 `-l clike`。多目录公共根按**路径段**最长公共祖先计算，不做字符前缀截断。
- 超出支持范围（相对路径、多个 `-fp`、引号包裹、路径含逗号等）一律显式报错并说明原因，不猜测。
- 该侧全部明细路径（文件键、函数 `file_name`、危险函数/冗余代码键、重复引用、`huge_folders` 键）必须位于某个 `-fp` 扫描路径之下（按路径段比较前缀）。

### 3.6 目录树与超大目录

- 从**已统计源码文件**恢复目录树：文件的祖先目录计入，直到扫描公共根为止；有文件时公共根计入一次，无文件时目录数为 0；不补磁盘空目录。
- 目录直接子项数 = 直属已统计文件数 + 直属“含已统计文件的子目录”数（去重、非递归）。超大目录按该数**严格大于** `huge_folder` 阈值判定，`huge_folders` 输出这些目录及其直接子项数。
- 以上为模拟数据约定（官方口径同样不计空子目录），内部扫描器的完整过滤集合未核验。

### 3.7 重复代码内部建模

生成器必须维护内部“非空非注释代码行位置 + 重复覆盖”模型（L3），保证重复量可复算：

- 先建立每文件的有效物理行集合，再建立重复关系；`file_sizes[path][2]` = 该文件所有重复片段**有效覆盖集合并集**的大小。
- 允许空行、注释行与重叠片段，避免只有理想化连续行数据；保证 `0 ≤ 重复行数 ≤ 有效行数 ≤ raw_line`。
- `file_duplication` 保存完整文件内容 MD5 一致的重复文件组；文件后缀可以不同，但不同有效行数、物理行数的文件不能作为已知相同内容的正例。整文件重复成员还须满足“重复行数 = 有效行数”；反向不要求。输入未携带源码或 MD5，L2/L3 的引用、数量和覆盖校验不能证明内容一致。现有随机生成器仅模拟成员关系，尚无内容身份模型，不作为 MD5 等价性的 golden 依据；人工候选须另提供可核对的内容证据。
- 内部模型不进入扫描 JSON，也不要求生成或输出源码正文。

## 4. 汇总指标公式（33 项）

记号：`F` 为 `file_sizes` 文件集合，三元组 `[n_f, r_f, d_f]`；`M` 为普通函数集合（排除尾对象）；`D` 为 §3.6 目录集合；`U` 为 `file_duplication` 所有组成员路径的集合并集；`H`/`S` 为头/源文件（按 §3.5 后缀）；`div(a,b)` 在 `b=0` 时取合成约定 `0`。所有比值先用未舍入值计算，输出按 §3.3 舍入。

| # | 字段 | 公式／口径 |
|---:|---|---|
| 1 | `code_size` | `ΣF n_f` |
| 2 | `raw_lines` | `ΣF r_f` |
| 3 | `methods_total` | `|M|` |
| 4 | `cyclomatic_complexity_total` | `ΣM cyclomatic_complexity` |
| 5 | `cyclomatic_complexity_per_method` | `div(#4, methods_total)` |
| 6 | `maximum_cyclomatic_complexity` | `M` 的复杂度最大值；无函数为 `0` |
| 7 | `huge_cyclomatic_complexity_total` | 复杂度严格 `>` 阈值的函数数 |
| 8 | `huge_cyclomatic_complexity_ratio` | `100 × div(#7, methods_total)` |
| 9 | `method_lines` | `ΣM nbnc_loc` |
| 10 | `lines_per_method` | `div(#9, methods_total)` |
| 11 | `huge_method_total` | `nbnc_loc` 严格 `>` 阈值的函数数 |
| 12 | `huge_method_ratio` | `100 × div(#11, methods_total)` |
| 13 | `files_total` | `|F|` |
| 14 | `folders_total` | `|D|` |
| 15 | `lines_per_file` | `div(code_size, files_total)` |
| 16 | `huge_headerfile_total` | `H` 中 `n_f` 严格 `>` 阈值的文件数 |
| 17 | `huge_headerfile_ratio` | `100 × div(#16, files_total)` |
| 18 | `huge_non_headerfile_total` | `S` 中 `n_f` 严格 `>` 阈值的文件数 |
| 19 | `huge_non_headerfile_ratio` | `100 × div(#18, files_total)` |
| 20 | `huge_folder_total` | 直接子项数严格 `>` 阈值的目录数 |
| 21 | `huge_folder_ratio` | `100 × div(#20, folders_total)` |
| 22 | `file_duplication_total` | `|U|`（成员路径并集，不是组数） |
| 23 | `file_duplication_ratio` | `100 × div(#22, files_total)` |
| 24 | `non_hfile_duplication_total` | `|U ∩ S|` |
| 25 | `non_hfile_duplication_ratio` | `100 × div(#24, files_total)` |
| 26 | `code_duplication_total` | `ΣF d_f` |
| 27 | `code_duplication_ratio` | `100 × div(#26, code_size)` |
| 28 | `non_hfile_code_duplication_total` | `ΣS d_f` |
| 29 | `non_hfile_code_duplication_ratio` | `100 × div(#28, code_size)`（分母是全体代码行，模拟约定含 ×100） |
| 30 | `unsafe_functions_total` | 逐文件、逐危险函数名的去重行号数组长度之和 |
| 31 | `unsafe_functions_kloc` | `1000 × div(#30, code_size)`（无 `<1000` 特例） |
| 32 | `redundant_code_total` | 所有冗余块起始行数组的条目数之和（单位是块，不是行） |
| 33 | `redundant_code_kloc` | `code_size < 1000` 时为 `0`；否则 `1000 × div(#32, code_size)` |

易错边界：

1. #17/#19/#23/#25 的分母是 `files_total`，#27/#29 的分母是 `code_size`，都不是头/源文件各自的子集分母。
2. 全部阈值比较为严格 `>`；夹具须覆盖 `阈值-1`、`=阈值`、`+1` 三档。
3. #6 须与尾对象 `maximum_cyclomatic_complexity` 及 `M` 实际最大值三方一致；尾对象 `maximum_nbnc_loc` 是第 34 个明细派生值，不属于 33 项 summary 必需指标。
4. 非空文件（`r_f ≥ 1`）可以有 `n_f = 0`（纯注释/空白）；“文件非空过滤”与“有效行为零”是两件事。

## 5. 生成顺序（先明细，后汇总）

1. **固定种子与配置**：一切随机来自固定 seed；配置（规模、分布、变化比例、阈值、版本串）随数据记录；同 seed 同配置必须产出一致结果（建议字节级一致，至少语义一致）。
2. **目录树与文件集合**：从 `-fp` 路径集合生成树；后缀按 §3.5；`r_f ≥ 1`、`n_f ≤ r_f`；路径不得规范化碰撞；名字符集与长度可控（覆盖长路径场景）。
3. **有效行模型**：每文件内部记录有效物理行号集合；`n_f = |有效行集合|`。
4. **函数明细 `M`**：每个函数分配文件内**不相交**的有效行子集；`nbnc_loc` = 子集大小；`start_line ≤ end_line ≤ r_f`（含末行）；同文件允许多个同名函数；`ΣM nbnc_loc ≤ n_f`；圈复杂度合成约定 ≥ 1；输出按 `(file_name, start_line)` 升序（合成约定，消费方不得依赖顺序）。
5. **重复关系**：
   - 片段组：组名扫描内唯一（合成命名 `code_duplication_N`）；每组 ≥ 2 片段，允许同文件、允许覆盖重叠；片段 = (文件, 起始有效行, 长度 L ≥ 1)，覆盖 = 自起始行沿内部有效行序列前进 L 行；不计算物理结束行。
   - `d_f` = 该文件全部片段覆盖并集大小；`0 ≤ d_f ≤ n_f`。
   - 整文件组：使用字段 `file_duplication`，组名在扫描内独立；每组 ≥ 2 个不同文件，完整内容 MD5 一致且 `d_f = n_f`（§3.7）。目前随机生成器尚无内容模型，生成的组关系不证明 MD5 相等。
   - 两类组独立生成，不强行建立组间对应。
6. **危险函数**：从预置名称表（典型 C 危险函数，合成约定，不声称与内部检测清单一致）生成 `(file, name, line)`；行号取自该文件有效行（内部模型）；输出按名称分行号去重升序数组；同一行不同名称分别保留；`#30 = Σ len(数组)`。
7. **冗余代码块**：每块一个起始物理行；内部置于注释行（官方口径为注释中的冗余代码块），输出仅起始行号；同文件起始行唯一升序（合成约定）；`#32 = Σ 条目数`。
8. **`huge_folders`**：由文件树按 §3.6 复算直接子项数，输出超限目录。
9. **尾对象**：由 `M` 求 `maximum_cyclomatic_complexity` 与 `maximum_nbnc_loc`，置于 `method_metrics` 末尾；无函数时数组只含 `[{"maximum_cyclomatic_complexity": 0, "maximum_nbnc_loc": 0}]`，不得为空数组。
10. **summary 计算**：按 §4 从同一套明细派生全部 33 项；`cmetrics_version` 为合成标记串（避免误认真实工具输出，两侧按场景配置相同或不同）；`huge_threshold` 逐侧记录生效值。
11. **输出组装**：省略 `warning_suppression_*` 与片段 `end_line`；序列化无重复键、无非标准数值；对象键顺序不作要求。

### 5.4 可复原性边界（必须如实声明）

仅凭输出 JSON 的起点与长度，通常**不能**重建片段的有效覆盖并集。因此：

- L2 只能验证 `Σd_f` 与 `code_duplication_total` 一致、`0 ≤ d_f ≤ n_f ≤ r_f` 等聚合关系；
- `d_f` 是否真为片段覆盖并集，只有 L3（生成端内部模型）能断言；
- 对外部输入，重复并集正确性**不可证**；报告与校验输出必须区分这两层，不得宣称 L2 已验证并集事实。

## 6. baseline/current 场景构造

- 从同一 baseline 明细施加**有记录**的增删改生成 current；每侧各自重算汇总；目标变化比例由明细改动控制，不直接修改 delta 或 summary。
- 变化算子（按对象）：文件新增/移出/路径移动；行数增减；函数新增/删除/修改（含同名歧义与行号整体移动）；重复组新增/删除/片段移动；整文件重复成员进出；危险函数位置增删与行号移动；冗余块移动；目录结构变化；两侧 `cmetrics_version`/`huge_threshold` 差异（可比性提示素材）。
- **变化台账**：逐条记录 (对象, 字段, 旧值 → 新值)，作为 L3 断言预期差值的依据；台账是生成器内部产物，不进入扫描 JSON。
- 两侧输出均可独立通过 L1–L2；台账预期只断言受控字段，不阻止派生值的连带变化。

## 7. 正确性夹具最小集

正例（须通过 L1+L2，内部模型通过 L3）：

1. 空扫描：无文件；`method_metrics` 仅含双 0 尾对象；空容器 `{}`；`folders_total = 0`。
2. 仅注释/空白文件：`r_f > 0, n_f = 0`；`lines_per_file = 0`。
3. 有文件无函数；有函数无重复；全无问题的空容器。
4. 阈值边界三档（文件、函数、目录各自取 `阈值-1`/`=`/`+1`）。仅阈值不同（`threshold-change`）仍比较超大明细：在身份映射、数值和覆盖可靠时，按各侧阈值严格 `>` 判定，展示可确定的新增／退出超限、两侧数值及有意义的观测差值，明确提示“阈值变化，清单进出和数值变化不证明代码恶化或改善”。版本、映射、未知、歧义与覆盖限制继续适用；详情放开不等于净影响分解放开，阈值不可比等情形仍不输出确定净影响或排名。
5. 密度边界：`code_size = 999/1000/1001` → `redundant_code_kloc` 为 `0/计算/计算`。
6. 重叠片段：同文件交错覆盖 → `d_f` 为并集而非长度和。
7. 同文件片段组、跨文件组、整文件重复组并存。
8. 同文件多个同名函数；两侧键基数不同（对比素材）。
9. 多路径 `-fp` 与公共根；根层级两侧变化（对比素材）。
10. 长路径、长函数名、中文字符串（输入安全素材）。

负例（独立标记存放，不得与正常夹具混用）：

- **L1 负例**：缺必填字段；未知字段；`method_metrics: []`；双尾对象；三元组长度 ≠ 3；`r_f = 0`；相对路径；百分比 > 100；片段组仅 1 片段；整文件组成员 < 2 或重复。
- **L1 接受、L2 必须拒绝**：尾对象唯一但不在末位；最大值与明细不符；汇总与明细复算不符；引用不存在的文件；明细路径在扫描路径之外；行号超出 `r_f`；`d_f > n_f`；`end_line < start_line`；`huge_folders` 与文件树复算不符；命令缺 `-l clike`、多 `-fp` 或含不支持路径形式。
- **L3 负例**：`d_f` 与片段覆盖并集不符；台账与实际差值不符；同 seed 两次生成不一致。

## 8. 容量压力数据要求

按 FSR §8.3：两侧**均达到**每侧 10 万文件、100 万函数；变化比例覆盖低、中等、接近/达到 100%；极端分布包括大量新增/移出、大重复组、深宽目录、长路径/长函数名、大量同名歧义。逐数据集记录对象数、两侧重合率、变化比例与保留比例。生成耗时（≤ 10 分钟）与内存（≤ 8 GiB）按 FSR §6.3 作为实现目标预演，但预演结果不冒充 P1–P3 实测。压力数据按种子可重建，不要求提交入库。

## 9. 开放边界登记

以下事项不阻塞生成，登记处理方式，不得以默认值掩盖或宣称已核验：

| 边界 | 当前处理 |
|---|---|
| `non_hfile_code_duplication_ratio` 真实内部尺度 | 模拟约定含 ×100、分母 `code_size` |
| `warning_suppression_kloc` 是否与总数一并移出 | 与总数一并不生成（密度依赖已忽略的总数） |
| 真实扫描器行号 0/1 起点 | 模拟采用 1-based；发现内部证据后复核 |
| 零分母真实输出 | 合成约定 `0`，仅覆盖已定义场景 |
| 重复组成员最小基数、整文件重复判定、冗余块行号是否去重 | 列为合成约定，不冒充输入契约 |
| 组名编号与函数名 `()` 形式 | 合成命名约定 |
| 符号链接、`./`/`..`、路径含逗号/引号、Windows 路径 | 不支持，显式报错 |
| 官方阈值/`<1000` 规则与内部版本一致性 | 逐侧读取自身 `huge_threshold`；密度特例仅用于冗余项 |
| 外部输入的重复并集正确性 | 不可证（§5.4），按能力边界声明 |

## 10. 实现状态与验证器说明

- 生成脚本实现：已基于 Python 3.12+、`msgspec`、`jsonschema`、`polars` 完成独立生成脚本与分层校验器（`cmetrics_cmp_viz.cli`）。
- 验证器特性：
  - L0：原生拦截重复对象键与 `NaN`/`Infinity` 非标准常量；
  - L1：基于 `jsonschema.Draft202012Validator` 执行全量模式校验；
  - L2：实现 33 项指标严格重算、尾对象最大值三方一致性、`-fp` 扫描路径段最长公共祖先检查及超大目录重算；
  - L3：校验内部有效物理行覆盖模型、整文件重复等价性及变化台账。
  - 所有对外业务浮点数（含均值、百分率、密度及 `_kloc`、差值和净影响）统一按十进制 Half-Up 四舍五入至两位小数，不能截断；内部保留未舍入分子／分母及精确值用于计算、比较、分类、筛选、排序和聚合，不能用显示舍入值分类。允许显示分项之和与显示总量存在舍入尾差。

## 11. 模拟数据生成器与校验器使用指南 (CLI 操作手册)

### 11.1 环境准备

确保已安装 `uv`，并在项目根目录下完成依赖同步：

```bash
uv sync
```

### 11.2 生成单个模拟扫描报告

使用 `generate` 子命令生成单个符合 L0–L3 规范的扫描 JSON 文件及内部行覆盖模型：

```bash
uv run python -m cmetrics_cmp_viz.cli generate \
  --output-dir ./output/single_scan \
  --seed 42 \
  --num-files 20 \
  --cmetrics-version "mock-scan-v1.0.0"
```

**产物说明**：
- `output/single_scan/mock_scan.json`：符合 Schema 的完整扫描报告（含 33 项 summary 及 7 类明细）。
- `output/single_scan/internal_model.json`：生成器内部物理行与有效行覆盖模型（用于 L3 校验）。

### 11.3 生成 Baseline / Current 演化对与变化台账

加入 `--pair` 参数可生成从 Baseline 演化出 Current 的一对数据，同时产出有据可查的变化台账（Change Ledger）：

```bash
uv run python -m cmetrics_cmp_viz.cli generate \
  --pair \
  --output-dir ./output/pair_scan \
  --seed 2026 \
  --num-files 30
```

**产物说明**：
- `output/pair_scan/baseline.json`：基线扫描报告；
- `output/pair_scan/current.json`：发生增删改变动后的当前扫描报告；
- `output/pair_scan/change_ledger.json`：变化台账，记录所有文件新增、删除或内容修改的具体差异。

### 11.4 对扫描报告执行分层校验

使用 `validate` 子命令对扫描报告进行 L0–L3 任意级别的严格检验：

```bash
# 1. 基础结构与 Schema 校验 (L1)
uv run python -m cmetrics_cmp_viz.cli validate ./output/single_scan/mock_scan.json --level L1

# 2. 全量语义与 33 项指标公式复算 (L2，默认级别)
uv run python -m cmetrics_cmp_viz.cli validate ./output/single_scan/mock_scan.json --level L2

# 3. 内部物理行模型覆盖并集与变化台账校验 (L3)
uv run python -m cmetrics_cmp_viz.cli validate ./output/single_scan/mock_scan.json \
  --level L3 \
  --internal-model ./output/single_scan/internal_model.json
```

**返回码与诊断**：
- 校验通过时返回退出码 `0`，并打印各级别通过日志；
- 校验失败时返回退出码 `1`，并逐项输出错误位置与具体不符的原因。

### 11.5 Python 代码内部调用范式

可在 Python 脚本或单元测试中直接调用生成器与校验器核心 API：

```python
from cmetrics_cmp_viz.generator import GeneratorConfig, MockDataGenerator
from cmetrics_cmp_viz.validator import validate_l1, validate_l2, validate_l3

# 1. 配置并生成报告
config = GeneratorConfig(seed=123, num_files=15)
generator = MockDataGenerator(config)
report, internal_model = generator.generate_single_report()

# 2. 执行校验断言
l1_errors = validate_l1(report)
assert l1_errors == [], f"L1 校验失败: {l1_errors}"

l2_errors = validate_l2(report)
assert l2_errors == [], f"L2 校验失败: {l2_errors}"

l3_errors = validate_l3(report, internal_model)
assert l3_errors == [], f"L3 校验失败: {l3_errors}"
```
