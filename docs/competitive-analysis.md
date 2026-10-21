# 竞品与同类方案分析：度量对比可视化报告

- 编制日期：2026-10-21
- 状态：调研完成；所有事实均核验自官方一手来源（文档、仓库源码、规格页面），来源与核验日期见第 9 节
- 用途定位：**技术借鉴为主**——为 [FSR](FSR.md) 的 P1–P3 原型验证收集可借鉴实现；结论章节以"参考和借鉴已有方案"为导向
- 范围边界：不重新评审 FSR 已确认的交付约束（离线单文件、数据不外传、13 类对比输出、目标规模）；不下"自研 vs 复用"断言；许可证仅作事实登记，不构成合规意见；所有条目均为资料调研，未实际运行或压测任何竞品

## 1. 结论摘要

1. **没有任何被调研项目同时满足本项目的四个核心要素**：单文件 HTML、数据内嵌、每侧 10 万文件／100 万函数规模、baseline/current 双侧全量对比。四要素组合是空缺的，这与 FSR"条件性可行、需原型验证"的判断一致。
2. **每个单一要素都有竞品给出已验证的实现手法**，可以直接进入 P0–P3 的候选实现清单：单文件模板与 `</script>` 转义（webpack-bundle-analyzer、rollup-plugin-visualizer）、自包含 HTML 选项（pytest-html、mochawesome）、零 JS 静态报告（scc）、大规模浏览器端查询（Perspective、Arquero、DuckDB-Wasm）。
3. **对比语义上最接近的借鉴对象是 SonarQube 的 new code definition 与 CodeScene 的 delta analysis**：两者都把"对比基线"显式化为可配置定义，而不是隐含假设。但它们都是"增量／新代码"语义，而本项目是两侧全量扫描差分，口径不同，只能借鉴其"显式化"思想。
4. **B 类竞品的报告规模普遍停留在统计元数据级**（构建产物体积、测试结果），没有公开声明过"单 HTML 渲染百万明细行"。FSR 第 6 节的容量风险没有现成的业界证据可以直接引用，P3 的全量变化压力测试仍是不可省略的验证关卡。

## 2. 调研范围与方法

调研对象分三类（范围经需求方确认）：

- **B 类：单文件／离线 HTML 报告工具**（借鉴主战场，7 个）：speedscope、lizard、scc、pytest-html、mochawesome（marge）、rollup-plugin-visualizer、webpack-bundle-analyzer。其中 lizard、scc 兼具代码扫描与 HTML 报告输出双重身份，按其报告形态归入 B 类。
- **C 类：浏览器端大规模数据查询与表格技术**（3 个）：DuckDB-Wasm、Perspective、Arquero。这是"技术路线竞品"而非完整产品，主要服务容量与查询架构的借鉴。
- **A 类：代码度量／质量平台**（精简，4 个 + 1 个内部对照）：SonarQube、SciTools Understand、CodeScene、腾讯 TScanCode，另加华为 CodeCheck／Cmetrics 公开能力对照。

方法：`fetch_content` 直接读取官方仓库与文档（GitHub 仓库为本次克隆快照，源码级结论标注了具体文件路径）；DuckDB-Wasm 部分复用仓库既有研究笔记[20]中已核验的官方引文。检索关键词不依赖二手评测。限制：GitHub 内容是 `main` 分支快照，发布时须按选定版本重新核验；lizard、pytest-html 等项目未做本地运行验证。

## 3. 总览对标矩阵

矩阵覆盖 B、C 两类共 10 项。维度沿用第 2 节确认的 7 维（许可证不作为对比维度，仅在条目中登记）。

| 项目 | 交付形态 | 数据嵌入 | 计算位置 | 大数据渲染 | baseline 对比 | 生成工具链 | 规模声明 |
|---|---|---|---|---|---|---|---|
| speedscope | 网页应用 + 自包含目录（多文件） | 不内嵌，运行时经文件选择器载入 | 纯浏览器端 | Canvas 火焰图 + minimap | 无（多 profile 并列切换） | npm CLI / 静态发布 | 官方未声明上限 |
| lizard | 单 HTML | 数据内联（DOM 表格） | 生成端聚合 + 浏览器端 DataTables 排序 | DOM 表格分页 | 无 | Python CLI（`-H`） | 官方未声明 |
| scc | 单 HTML | 内联（静态 HTML/CSS/SVG） | 生成端全部（零 JS） | 静态 CSS/SVG 图表 | 无（git 历史段仅单仓库维度） | Go CLI（`--report`） | 扫描端 40 TB 量级[9]，报告渲染未声明 |
| pytest-html | 单 HTML（`--self-contained-html`）；默认多文件 | CSS/图片内联（Base64）或旁置 | 生成端渲染表格行 + 浏览器端 JS 排序筛选 | DOM 表格 | 无 | pytest 插件 | 官方未声明 |
| mochawesome (marge) | 单 HTML（`--inline`）；默认多文件 | JS/CSS 内联 + 数据经 HTML 转义的 body 属性 | 生成端 + 浏览器端 React | DOM 树 + ChartJS | 无 | mocha reporter / marge CLI | 官方未声明 |
| rollup-plugin-visualizer | 单 HTML | UI 代码内联 + 数据为原始 JSON 字面量 | 生成端统计 + 浏览器端渲染 | Sunburst／Treemap／Flamegraph／Network 图 | 无 | Rollup/Vite 插件 + CLI | 未声明；报告仅含统计元数据[8] |
| webpack-bundle-analyzer | 单 HTML（`analyzerMode: static`） | UI 脚本内联 + `window.chartData`（`<`→`\u003c` 转义） | 生成端统计 + 浏览器端渲染 | Canvas 交互式 Treemap 缩放 | 无（多 bundle 并列） | webpack 插件 + CLI | 官方未声明 |
| DuckDB-Wasm | 库（多文件部署：主库 + JS Worker + WASM + 扩展） | 不适用（引擎，非报告） | 浏览器端 SQL（可配 Worker） | 无 UI，配第三方表格 | 查询层可自定义 | JS 打包工具集成 | `coi` 线程版依赖跨域隔离头，`file://` 不可用[20] |
| Perspective | 组件库（多文件） | Arrow/CSV/JSON 运行时载入 | 浏览器端 WASM 引擎（C++），可服务端 | 虚拟滚动网格 + WebGL 图表 | 无内置 | npm/pip/cargo | memory64 构建 >4GB、OPFS 列分页[15] |
| Arquero | 库（可整体打包内联） | Arrow/CSV/JSON 运行时载入 | 浏览器端 JS 列式查询 | 无 UI（配可视化库） | 查询层可自定义 | npm | "百万行级"处理声明[16] |

**矩阵解读**：B 类 7 项全部没有 baseline 对比能力——它们都是"单快照报告"；A 类平台有对比/增量语义但交付形态是服务端。数据嵌入一列中，只有 B 类的单文件路线与本项目同构；C 类三者均为"应用与数据分离"或"运行时载入"，其中前两者的部署形态已被 FSR 5.4 节排除（DuckDB-Wasm 多资产、Perspective 组件库），但它们的**引擎设计**仍是容量借鉴对象。

## 4. B 类：单文件／离线 HTML 报告（重点调研）

### 4.1 speedscope

- **定位**：交互式性能剖析（flame graph）查看器，支持十余种语言剖析格式导入[1]。
- **核心机制**：官方强调"profiles are not uploaded anywhere -- the application is totally in-browser"[1]；数据不内嵌进报告，而是运行时经文件选择器或拖拽载入。发布包提供"self-contained directory"：解压后直接在 Chrome 或 Firefox 打开 `index.html`，官方 README 明确将此列为"没有 npm/node 时的离线使用方式"[1]。渲染为 Canvas 火焰图 + minimap 双区布局，提供 Time Order／Left Heavy／Sandwich 三视图与全库搜索[1]。
- **与本项目对标**：它是"离线 HTML 分析大体量明细数据"的最成熟先例之一，但选择了**应用与数据分离**而非数据内嵌——用户拿到的不是分享型报告，而是工具 + 各自的剖析文件。
- **可借鉴点**：
  - 【可复用思路】minimap + 主视图的 Canvas 双区导航、只绘制可见区域的渐进渲染策略，对应 FSR 5.3 的虚拟列表与图表要求。
  - 【可复用思路】"工具目录 + 双击 index.html"的离线形态证明了 `file://` 下纯前端应用可行——但其数据经文件输入载入，绕开了数据内嵌的容量问题，不能直接类比。
  - 【仅供参考】应用/数据分离不符合本项目"单文件交付"约束（FSR 5.4 已排除），此条目反向佐证了该约束的独特性。
- **许可证**：MIT[1]。
- **来源**：GitHub 仓库 jlfwong/speedscope（README，本次克隆快照），核验日期 2026-10-21[1]。

### 4.2 lizard

- **定位**：多语言圈复杂度／重复代码扫描器，功能上与 Cmetrics 最接近（nloc、CCN、copy-paste 检测）[2]。
- **核心机制**：`-H, --html` 输出带交互表格的 HTML 报告[2]。报告为单 HTML、数据内联；但表格交互依赖 **CDN 加载的 jQuery 3.7.0 与 DataTables 1.13.4**（`lizard_ext/htmloutput.py` 第 55、57、59 行硬编码 `https://cdn.datatables.net/...`），并内置降级逻辑：DataTables 不可用时"Displaying static table"，保留静态表格、放弃排序/搜索/筛选。
- **与本项目对标**：数据规模与指标语义同本项目最接近，但交付形态直接违反 FSR"零外部运行依赖"约束——**断网双击时交互全部降级**。这是一个发生在同类工具身上的真实反例。
- **可借鉴点**：
  - 【可复用思路】"外链资产不可用时的静态降级"值得纳入 FSR 5.3 的错误处理设计：即使本项目计划全内嵌，也应为 Worker/解压/脚本失败提供可读的静态兜底。
  - 【仅供参考】CDN 依赖模式是 FSR 第 7 节明确禁止的形态，不采纳。
- **许可证**：MIT[2]。
- **来源**：GitHub 仓库 terryyin/lizard（README 及 `lizard_ext/htmloutput.py`、`templates/index.html`，本次克隆快照），核验日期 2026-10-21[2]。

### 4.3 scc

- **定位**：Go 实现的代码计数器（对标 cloc/tokei），含复杂度估算与重复行（ULOC）度量[3]。
- **核心机制**：`scc --report` 生成"self-contained, infographic-style HTML page"，官方原文明确"bundles its own CSS and inline SVG -- **no external network requests, no JavaScript runtime dependencies**"，可本地打开、可入库、可托管[3]。报告含概览指标、语言分布、行长度直方图、热点、变更耦合、作者汇总、时间线、COCOMO 成本与逐文件表格；git 历史段（hotspots、coupling、authors、timelines）仅在 git 仓库内生成，仓外优雅省略[3]。
- **与本项目对标**：这是**唯一一个把"完全零 JS 的自包含 HTML"作为明确设计目标**的被调研项目。它证明：概览级报告可以完全不需要 JavaScript；代价是没有任何交互下钻。
- **可借鉴点**：
  - 【可复用思路】首屏概览层采用生成端预渲染的静态 HTML/CSS/SVG（FSR 5.3 已要求"首屏使用预计算概览"），把 JS 交互只留给明细下钻层；scc 证明该分层在真实工具中成立。
  - 【可复用思路】"--report-skip LIST"按节裁剪报告段的 CLI 设计，对应 FSR 3.3 的裁剪透明化（用户可见地控制省略范围）。
  - 【可复用思路】git 历史段"数据不可用时优雅省略"的做法，对应 FSR 4.2 的未知/缺失语义展示。
- **许可证**：MIT[3]。
- **来源**：GitHub 仓库 boyter/scc（README"HTML Report"节，本次克隆快照），核验日期 2026-10-21[3]。

### 4.4 pytest-html

- **定位**：pytest 官方生态的 HTML 测试报告插件[4]。
- **核心机制**：官方文档明确，默认将 CSS、图片等资产**分开存放以遵守 CSP**；`--self-contained-html` 才生成自包含单文件报告，并警告"以文件或链接方式加入的图片在 standalone 报告中可能无法按预期显示"[4]。交互（排序、筛选、折叠）基于浏览器端 JS，初始状态可通过 URL 查询参数（`?collapsed=`、`?visible=`、`sort`）控制[4]。
- **与本项目对标**：注意其默认值选择——**多文件是默认、单文件是可选项**，理由是 CSP。本项目无外部 CSP 策略约束（自包含文件无服务端注入面），单文件内嵌不会触发同样的冲突，但这提醒 P1 验证时须实际测试内嵌资产在 `file://` 下的行为。
- **可借鉴点**：
  - 【可复用思路】URL 查询参数驱动初始视图状态（如默认折叠已通过项）。若 P1 验证 `file://` 下查询参数可用，可用于"默认展开恶化项、折叠正常项"的场景预设。
  - 【可复用思路】"自包含模式下哪些资产会失败"的显式警告清单，对应 FSR 3.3 的省略提示义务。
- **许可证**：MPL-2.0[4]。
- **来源**：pytest-html 官方文档 User Guide，核验日期 2026-10-21[4]。

### 4.5 mochawesome（mochawesome-report-generator / marge）

- **定位**：mocha 测试框架的报告生成器，React 实现的可视化测试报告[5]。
- **核心机制**：默认输出目录结构（`mochawesome.html` + `assets/` 含 JS/CSS/字体）；`-i, --inline` 将 scripts/styles 内联进 HTML（默认 false）；`--cdn` 可改从 unpkg 加载资产[5]。数据嵌入方式特殊：**报告数据经 HTML 转义后写入 `<body data-raw="..." data-config="...">` 属性**（`src/lib/main-html.js` 第 55 行），React 应用启动后从属性读回渲染。官方列出"Offline viewing"为特性[5]。
- **与本项目对标**：证明了"数据放 HTML 属性而非 script 标签"是可行的内嵌变体——天然规避 `</script>` 提前闭合问题，代价是 HTML 属性转义与序列化体积的权衡。
- **可借鉴点**：
  - 【可直接复用实现】`data-raw` 属性内嵌方案（MIT），可作为 FSR 5.1"内嵌压缩数据块"的备选容器；是否优于 `<script type="application/json">` 须在 P1 按 Base64/转义开销实测。
  - 【可复用思路】字体文件（Roboto/Material Icons）内嵌进报告的资产清单管理方式——本项目应直接避免外部字体（FSR 第 7 节），marge 的资产内联清单是现成的核对模板。
- **许可证**：MIT（mochawesome 与 marge 均为 MIT）[5]。
- **来源**：GitHub 仓库 adamgruber/mochawesome 与 adamgruber/mochawesome-report-generator（README 及 `src/lib/main-html.js`，本次克隆快照），核验日期 2026-10-21[5]。

### 4.6 rollup-plugin-visualizer

- **定位**：Rollup/Vite 构建产物体积分析，输出单 HTML 图表报告[6]。
- **核心机制**：单 HTML 模板由三部分内联组成——`<style>` 全部样式、`<script>` 全部图表 UI 代码、`const data = {...}` 原始 JSON 字面量（`plugin/render-template/html.ts` 的 `buildHtmlTemplate`）；script 内容用 `/*<!--*/ ... /*-->*/` 注释护栏包裹；模板标题经 `htmlEscape` 转义[6]。`plugin/compress.ts` 用 Node zlib 计算 gzip/brotli **展示体积**（level 9 / brotli 最高质量），**不用于数据压缩内嵌**——数据是未压缩 JSON 字面量[6]。官方声明"Generated HTML files do not include your source code contents. They only include ... Statistical metadata about your code"[6]。
- **与本项目对标**：这是与 FSR 5.1 推荐路线**结构上最相似**的模板（内嵌 UI + 内嵌数据 + 单文件），但数据规模小（构建元数据）且未做压缩内嵌——它恰好标出了本路线需要跨越的两步：压缩分块（FSR 5.3）与更大规模。
- **可借鉴点**：
  - 【可直接复用实现】单文件模板结构（内联 style + 内联 script + JSON 数据块）与 `/*<!--*/` 护栏（MIT）；其源码可作为 P1 最小验证页的起步模板改写。
  - 【可直接复用实现】`htmlEscape` 转义函数与"仅转义可控字段、数据另走通道"的分层（MIT）。
  - 【仅供参考】未压缩 JSON 内嵌不可取——本项目的 600 MB 级输入必须走 FSR 5.3 的压缩分块路线，此项目是反衬基线。
- **许可证**：MIT[6]。
- **来源**：GitHub 仓库 btd/rollup-plugin-visualizer（README 及 `plugin/render-template/html.ts`、`plugin/compress.ts`，本次克隆快照），核验日期 2026-10-21[6]。

### 4.7 webpack-bundle-analyzer

- **定位**：webpack 构建产物的交互式缩放 Treemap 分析器[7]。
- **核心机制**：`analyzerMode: static` 生成单 HTML 报告（默认 `report.html`），`server` 模式才起本地服务[7]。static 模式下应用脚本经 `getAssetContent` 内联（`src/template.js` 第 58–59 行），数据经 `window.chartData = ${escapeJson(chartData)}` 内联，其中 **`escapeJson` 将 JSON 中所有 `<` 替换为 `\u003c`** 以防 `</script>` 提前闭合（`src/template.js` 第 21–23 行），文件名与标题另经 `escape()` 转义[7]。支持 stat/parsed/gzip/brotli（及 zstd）四种体积口径切换[7]。
- **与本项目对标**：交互密度（缩放 Treemap、搜索、多口径切换）在 B 类中最高，且是"单文件 + 数据内嵌 + 完全离线"形态；其数据仍是构建统计元数据，明细行数远小于本项目目标。
- **可借鉴点**：
  - 【可直接复用实现】`\u003c` 转义函数——正是 FSR 7.4 要求的 `</script>` 注入防护，MIT 许可，实现一行，可作为输入适配层的标准步骤（注意它只处理 `<`，路径/函数名中的其他字符仍需配合整体转义策略）。
  - 【可直接复用实现】"全局变量 + 内联脚本"的静态模式数据交接约定（`window.chartData` / `window.enableWebSocket` 等），配合 Worker 化改造可作为 P1 数据通道雏形。
  - 【可复用思路】多口径切换（stat/parsed/gzip/brotli）对应本项目"原值/差值/百分点变化"的口径切换交互。
- **许可证**：MIT（Copyright JS Foundation and other contributors）[7]。
- **来源**：GitHub 仓库 webpack-contrib/webpack-bundle-analyzer（README 及 `src/template.js`，本次克隆快照），核验日期 2026-10-21[7]。

## 5. C 类：浏览器端大规模数据查询与表格

### 5.1 DuckDB-Wasm

- **定位**：DuckDB 编译为 WebAssembly 的浏览器内 SQL 引擎；FSR 5.4 已将其列为备选而非首选[20]。
- **核心机制**（复用仓库既有已核验研究笔记[20]）：部署需要主库、JS Worker、WASM Worker 与扩展组件，存在 `mvp`/`eh`/`coi` 变体；`coi` 线程版依赖 SharedArrayBuffer 与跨域隔离 HTTP 头，普通双击文件不具备该部署路径；官方 CDN 示例虽用 Blob 包装 Worker，仍在 Blob 内 `importScripts` 加载 CDN——"有 Blob 不等于离线自包含"；扩展默认从 `extensions.duckdb.org` 远程加载[20]。
- **与本项目对标**：SQL 能力对"全局筛选/排序必须真实覆盖全量"（FSR 5.3）有吸引力，但多资产部署、MIME、扩展与内存行为都需在真实 `file://` 逐项验证，且 FSR 已将其定位为"仅保留为备选"。
- **可借鉴点**：
  - 【可复用思路】其"分块列式存储 + 按需物化"的查询模型是 P2/P3 设计全局查询时的参照；若 P3 显示纯 JS 方案不达标，DuckDB-Wasm 是唯一有官方文档支撑的备选引擎。
  - 【仅供参考】默认部署形态（CDN、远程扩展）不满足零外连约束，采纳前提是完全重定向资产加载并禁用远程扩展，需专项验证。
- **许可证**：MIT（DuckDB 主仓库 LICENSE，Stichting DuckDB Foundation）[17]。
- **来源**：DuckDB 官方部署/实例化文档（经研究笔记[20]核验）与 DuckDB 仓库 LICENSE，核验日期 2026-10-21。

### 5.2 Perspective（perspective-dev/perspective，原 FINOS 项目）

- **定位**：面向大规模实时数据集的开源 data grid／透视表／图表组件[15]。
- **核心机制**：C++ 查询引擎编译为 WebAssembly，含 **memory64 构建以支持超过 4GB 的浏览器内数据集，并支持经 OPFS 将列分页到磁盘**；UI 为 Custom Element（含 React 绑定），提供"virtual-scrolling, editable data grid"与 WebGL 图表；数据读写支持 Apache Arrow、CSV、JSON；同一 Client API 可连进程内、Web Worker 或 WebSocket 远程引擎[15]。
- **与本项目对标**：它是"浏览器内渲染大规模明细表格"的最强参照，但其引擎为多资产 WASM 部署，组件级采纳与单文件约束冲突；虚拟滚动网格可直接对照 FSR 6.2 的渲染内存分析。
- **可借鉴点**：
  - 【可复用思路】**OPFS 列分页**——把放不进内存的列数据分页到浏览器私有文件系统。注意：OPFS 在 `file://` origin 下的可用性未经验证，若 P1 确认可用，它是突破 FSR 6.3"2 GiB 峰值内存"门槛的候选手段；若不可用，该思路退化为"加受控缓存上限"。
  - 【可复用思路】虚拟滚动网格的交互组织（排序/筛选在引擎层而非 DOM 层完成），对应 FSR 5.3"排序搜索不能只覆盖当前页"的要求。
- **许可证**：Apache-2.0[15]。
- **来源**：GitHub 仓库 perspective-dev/perspective（README，本次克隆快照），核验日期 2026-10-21[15]。

### 5.3 Arquero

- **定位**：面向 array-backed 数据表的 JavaScript 查询处理与变换库（关系代数、dplyr 风格 API）[16]。
- **核心机制**：纯 JS（无 WASM）、列式内存布局，官方声明"**Fast: process data tables with million+ rows**"与"Lightweight: small size, minimal dependencies"；查询对象可为数组、TypedArray 或 Apache Arrow 列；动词链式 API（filter/join/rollup/window 等）[16]。
- **与本项目对标**：**可以整体打包内联进单 HTML**（纯 JS、小体积），这是它与 DuckDB-Wasm/Perspective 的关键差异；"百万行级"声明与本项目每侧 100 万函数同量级，但"行数"不等于"排序/搜索交互全达标"，其声明场景是变换管道而非大规模交互报表。
- **可借鉴点**：
  - 【可直接复用实现】列式查询层（BSD-3）：若 P1/P2 需要在 Worker 内做全局筛选/排序/聚合，Arquero 是体积代价最小的候选引擎，先于 DuckDB-Wasm。
  - 【可复用思路】Arrow 列式内存与 TypedArray 直读，减少结构化克隆成本——对应 FSR 5.3 对 `postMessage` 复制开销的关注。
- **许可证**：BSD-3-Clause[16]。
- **来源**：GitHub 仓库 uwdata/arquero（README 及 LICENSE，本次克隆快照），核验日期 2026-10-21[16]。

## 6. A 类：度量／质量平台（精简画像）

A 类均为服务端或桌面形态，与本项目离线单文件交付不匹配；条目只保留"画像 + 对比设计借鉴 + 形态不匹配"。

### 6.1 SonarQube

- **画像**：代码质量平台，当前产品线分 SonarQube Server（自托管）、SonarQube Cloud、SonarQube for IDE[10]；Community Build 免费开源，完整功能在商业版。
- **对比设计借鉴**【可复用思路】：其"new code definition"把**对比基线显式化为项目级设置**（参考分支、前一版本、固定天数等口径），所有"新代码"问题/覆盖率均相对该定义计算；PR 场景下全部变更即新代码[11]。这对应本项目 FSR 4.6 的可比性要求——baseline 的口径（扫描版本、阈值、范围）应当与数据一起展示，而不是隐含假设。注意口径差异：SonarQube 是"增量/新代码"语义，本项目是两侧全量扫描差分，不能照搬其实现，只借鉴"显式化"思想。
- **形态不匹配**：服务端 + 数据库部署，需要持续运行的服务与浏览器访问，不符合离线单文件交付。
- **许可证**：Community Build 为开源（LGPL-3.0），商业版闭源收费[10]。
- **来源**：SonarSource 官方文档（docs.sonarsource.com），核验日期 2026-10-21[10][11]。

### 6.2 SciTools Understand

- **画像**：商业桌面代码理解/度量工具，15+ 语言，指标仪表盘、交叉引用、调用图、架构图；MISRA/AUTOSAR 合规检查，TÜV SÜD 认证（ISO 26262/IEC 61508/EN 50128）；提供 `und` CLI 与 Python API；官方强调"Keep your code local -- nothing gets sent to the cloud"[12]。
- **对比设计借鉴**【仅供参考】：以单快照深度度量与合规证据为主，未提供公开文档级别的双侧差分工作流；其价值在于佐证"度量明细 + 定位"的桌面工具形态成熟度。
- **形态不匹配**：商业桌面许可（本项目的扫描源是内部 Cmetrics，非 Understand）；按席位收费的闭源产品，不构成候选。
- **许可证**：商业专有[12]。
- **来源**：scitools.com 官网，核验日期 2026-10-21[12]。

### 6.3 CodeScene

- **画像**：商业代码质量/技术债平台（云与本地部署），以 Code Health 度量、热点分析著称；文档站 codescene.io[13]。
- **对比设计借鉴**【可复用思路】：**delta analysis**——"compares your current work against a previous state of your code"，通过 CI/CD 集成与 PR 检查执行，配合质量门槛（quality gate）对差分结果做阈值判定[13][14]。这与本项目"增长即待评审"的公司口径（FSR 3.1）同构：都是差分 + 阈值 → 处置信号。可借鉴其"差分结果必须解释覆盖范围（哪些提交/文件参与比较）"的呈现纪律；同样注意其语义是增量评审，不是全量重扫对比。
- **形态不匹配**：SaaS/本地服务，面向在线仓库集成；无离线单文件报告形态。
- **许可证**：商业专有[13]。
- **来源**：CodeScene 官方文档（codescene.io / docs.enterprise.codescene.io），核验日期 2026-10-21[13][14]。

### 6.4 腾讯 TScanCode

- **画像**：腾讯开源的 C/C++、C#、Lua 静态分析器；最近一次 release 为 v2.15.02（2022-04-28）；输出 XML 结果清单（`--xml`），提供 Windows/Linux/macOS 预编译产物与 GUI 规则包[18]。
- **对比设计借鉴**：无。输出为缺陷清单 XML，没有度量汇总、没有对比、没有 HTML 报告，与本项目能力交集仅在"C/C++ 扫描"。
- **形态不匹配**：纯扫描器；且 2022 年后无新 release，活跃度低。
- **许可证**：GPL-3.0[18]。
- **来源**：GitHub 仓库 Tencent/TScanCode（README 及 LICENSE，本次克隆快照），核验日期 2026-10-21[18]。

### 6.5 内部对照：华为 CodeCheck / Cmetrics

- **画像**：本项目输入即来自公司内部 Cmetrics 扫描器（华为 CodeCheck 体系）。公开资料仅官方规格页面：43 个度量参数、统计公式与默认阈值（FSR 2.3 节已逐项核验并登记证据边界）[19]。平台本体为云服务形态，公开资料未提供离线报告导出、双侧差分或单文件交付能力。
- **定位**：作为"上游数据源"存在，不是可选竞品；本项目报告工具填补的是其公开能力中不存在的"离线双侧对比可视化"空位。
- **来源**：华为云 Cmetrics 工具规格说明（经 FSR 核验），核验日期 2026-10-21[19]。

## 7. 可借鉴点汇总（按借鉴等级）

### 可直接复用实现（许可证允许）

| 借鉴点 | 来源 | 许可证 | 建议落点 |
|---|---|---|---|
| `\u003c` 转义防 `</script>` 提前闭合 | webpack-bundle-analyzer `src/template.js` | MIT | FSR 7.4 输入安全编码的标准步骤 |
| 单文件模板（内联 style + script + JSON 数据块）、`/*<!--*/` 护栏、标题 htmlEscape | rollup-plugin-visualizer `plugin/render-template/html.ts` | MIT | P1 最小验证页的起步模板 |
| 数据经 HTML 转义写入 body 属性的内嵌变体 | marge `src/lib/main-html.js` | MIT | P1 数据容器备选，与 script 标签方案对比实测 |
| 列式查询引擎整体内联（百万行级声明、纯 JS） | Arquero | BSD-3-Clause | P2 Worker 内全局筛选/排序/聚合候选，先于 DuckDB-Wasm |

### 可复用思路

| 思路 | 来源 | 对应 FSR 位置 |
|---|---|---|
| 首屏概览零 JS 静态化（CSS/SVG 预渲染） | scc `--report` | 5.3 预计算概览；JS 只留给明细下钻 |
| 外链/引擎失败时的静态降级表 | lizard `htmloutput.py` | 5.3 错误处理；Worker/解压失败的可读兜底 |
| URL 查询参数驱动初始视图（默认折叠/筛选/排序） | pytest-html | 交互预设（须先验证 `file://` 下查询参数可用） |
| 报告按节裁剪的显式 CLI 开关 | scc `--report-skip` | 3.3 裁剪透明化 |
| OPFS 列分页 + memory64 超 4GB 数据集 | Perspective | 6.3 内存门槛的候选手段（OPFS 的 `file://` 可用性待 P1 验证） |
| 虚拟滚动网格 + 引擎层排序筛选 | Perspective | 5.3 全局搜索必须覆盖全量 |
| 对比基线显式化为可见口径（版本/阈值/范围随数据展示） | SonarQube new code definition | 4.6 可比性与可追溯性 |
| 差分 + 阈值 → 处置信号，并解释比较覆盖范围 | CodeScene delta analysis | 3.1 "增长即待评审"的呈现纪律 |
| minimap + Canvas 双区渐进渲染 | speedscope | 5.3 图表不一次绘制百万对象 |

### 仅供参考

- 应用与数据分离的"工具目录"形态（speedscope releases）：证明 `file://` 纯前端可行，但不满足单文件交付约束。
- CDN 依赖的交互增强（lizard 的 jQuery/DataTables）：断网即降级，是本项目明确禁止的形态，仅取其降级思路。
- 服务端平台形态（SonarQube、CodeScene、Understand）：对比能力最强，交付形态全部不符合离线单文件约束。

## 8. 差异化定位

将矩阵各行与本项目的四要素对照，可得本项目在同一谱系中的位置：

1. **相对 B 类**：B 类验证了"单文件 HTML 承载交互报告"的可行谱系——从 scc 的零 JS 静态、pytest-html/marge 的可选内联，到 webpack-bundle-analyzer 的完整离线交互。但它们的载荷都是 MB 级统计元数据；本项目 150 MB/侧的输入、每侧 100 万函数的明细规模在 B 类中没有先例，FSR 第 6 节的容量风险属于**无业界先例可引**的自证风险，P1–P3 必须实测。
2. **相对 C 类**：C 类提供浏览器端大规模查询/渲染的引擎能力，但交付形态均为多资产或运行时载入。可作引擎层借鉴（Arquero 优先、DuckDB-Wasm 备选），不能替代报告形态。
3. **相对 A 类**：对比语义的成熟参照（new code definition、delta analysis），但均为"增量"语义 + 服务端形态。本项目"两侧全量扫描差分 + 目录/文件/函数/重复片段/超大项下钻 + 离线单文件"的组合在被调研范围内没有现成对应物。

## 9. 参考资料

来源均为官方一手资料；GitHub 条目为本次（2026-10-21）克隆快照，`main` 分支内容可能随时间变化，正式采用前须按选定版本重新核验。

| 编号 | 来源 | 链接 | 核验日期 |
|---|---|---|---|
| [1] | speedscope README（GitHub jlfwong/speedscope） | <https://github.com/jlfwong/speedscope> | 2026-10-21 |
| [2] | lizard README 与 `lizard_ext/htmloutput.py`（GitHub terryyin/lizard） | <https://github.com/terryyin/lizard> | 2026-10-21 |
| [3] | scc README"HTML Report"节（GitHub boyter/scc） | <https://github.com/boyter/scc> | 2026-10-21 |
| [4] | pytest-html 官方文档 User Guide | <https://pytest-html.readthedocs.io/en/latest/user_guide.html> | 2026-10-21 |
| [5] | mochawesome 与 mochawesome-report-generator README 及 `src/lib/main-html.js` | <https://github.com/adamgruber/mochawesome> ・ <https://github.com/adamgruber/mochawesome-report-generator> | 2026-10-21 |
| [6] | rollup-plugin-visualizer README 及 `plugin/render-template/html.ts`、`plugin/compress.ts` | <https://github.com/btd/rollup-plugin-visualizer> | 2026-10-21 |
| [7] | webpack-bundle-analyzer README 及 `src/template.js` | <https://github.com/webpack-contrib/webpack-bundle-analyzer> | 2026-10-21 |
| [8] | rollup-plugin-visualizer README"Disclaimer about generated files"节 | 同 [6] | 2026-10-21 |
| [9] | scc README（40 TB 处理案例引文） | 同 [3] | 2026-10-21 |
| [10] | SonarSource 文档首页（Server/Cloud/IDE 产品线） | <https://docs.sonarsource.com/sonarqube/latest/> | 2026-10-21 |
| [11] | SonarQube Server — Quality standards and new code | <https://docs.sonarsource.com/sonarqube-server/user-guide/about-new-code> | 2026-10-21 |
| [12] | SciTools 官网 | <https://www.scitools.com/> | 2026-10-21 |
| [13] | CodeScene 文档站 | <https://codescene.io/docs/> | 2026-10-21 |
| [14] | CodeScene Delta Analysis（CI/CD 集成指南） | <https://docs.enterprise.codescene.io/versions/7.4.1/guides/delta/automated-delta-analyses.html> | 2026-10-21 |
| [15] | Perspective README（GitHub perspective-dev/perspective） | <https://github.com/finos/perspective> | 2026-10-21 |
| [16] | Arquero README 与 LICENSE（GitHub uwdata/arquero） | <https://github.com/uwdata/arquero> | 2026-10-21 |
| [17] | DuckDB LICENSE（GitHub duckdb/duckdb） | <https://github.com/duckdb/duckdb> | 2026-10-21 |
| [18] | TScanCode README 与 LICENSE（GitHub Tencent/TScanCode） | <https://github.com/Tencent/TScanCode> | 2026-10-21 |
| [19] | 华为云 Cmetrics 工具规格说明（经 [FSR](FSR.md) 第 2.3 节核验） | <https://support.huaweicloud.com/intl/zh-cn/api-codecheck/codecheck_03_0016.html> | 2026-10-21 |
| [20] | [离线单 HTML 技术调查笔记](../.scratch/offline-report/research/offline-html-feasibility.md)（DuckDB 部署边界 S10/S11 及 file:// 机制引文） | 仓库内文档 | 2026-10-21 |
