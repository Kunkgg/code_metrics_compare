# 离线单 HTML 度量对比：有边界的可行性调查笔记

> 状态：研究资料，非最终报告、方案选择或 FSR。未实现报告、未编写基准程序、未执行浏览器验证。背景规模为**每侧** 10 万文件、100 万函数、2500 万代码行；两份扫描 JSON 可由 Python 离线预处理。交付约束是一个可双击打开的 `.html`，无服务端。

## 取证方式与限制

已读仓库 `AGENTS.md` 和 research skill。本任务由研究子代理执行。已使用 `web_enable` 后搜索官方资料；`fetch_content` 访问 MDN、WHATWG、DuckDB 时因环境 fake-IP/SSRF 检查被阻止。随后通过 `curl` 成功读取官方 GitHub 仓库中的原始文档/规范和 MDN browser-compat-data，未修改安全配置。下面直接引文均来自这些成功读取的原文，而非搜索服务生成的摘要。DuckDB 的 `docs/stable` 原始仓库路径返回 404，成功读取的是 `docs/current`，其 front matter 明确包含 stable 路径重定向。

来源是可变的 `main` 分支资料，不是固定版本保证；发布时须对选定浏览器和依赖版本重新核验。未上传业务文件、未调用付费服务；没有把实际扫描 JSON 发给搜索服务。

## 1. 可以支持的机制结论，以及不能推出的结论

**有条件的机制结论：单 HTML 内嵌 JS、CSS、压缩后文本编码的数据块，再从内嵌代码创建 Blob classic Worker，在 Worker 中解压、处理数据并传回有限结果，是由现有 Web API 支撑的组合。** MDN 展示了内嵌数据块 → Blob → object URL → Worker 的用法；Compression Streams 提供流式解压，ArrayBuffer 可以转移所有权。[S3–S7]

这只说明各机制能够组合，不是这份报告在所有 `file://` 浏览器中已经成功，更不代表百万函数筛选、排序、对比或启动时间已经获得保证。最终 HTML 字节数、解压后大小、记录字段、索引、字符串基数、对比规则、目标机器和交互要求均未知。2500 万代码行也不等于要嵌入 2500 万行源码：若只是计数与度量，载荷完全不同；目前不能假定是否包含源码。

可成立的前提包括：所有运行必需资产确实内嵌；没有 CDN、旁置 JSON、动态模块或扩展的隐含请求；目标浏览器允许该 `file://` 页面创建 Blob Worker；编码与压缩格式匹配；CSP 如存在，允许必要脚本、Worker 与 Blob；数据和计算的峰值内存落在目标环境可承受范围内。这里不选择编码、压缩算法、分块大小、查询引擎或 UI 库。

## 2. `file://`：不能把“同目录”当成同源保证

WHATWG URL Standard 在 `file` origin 分支写道：

> “Unfortunate as it is, this is left as an exercise to the reader. When in doubt, return a new opaque origin.” [S1]

MDN 的 File origins 段写道：

> “Modern browsers usually treat the origin of files loaded using the `file:///` scheme as opaque origins.” [S2]

并明确说同文件夹中的文件不一定被认作同源，可能触发 CORS 错误；file origin 行为依赖实现。[S2]

**对本任务的边界：**

- 不可据“都在本地”推断 `fetch('./data.json')`、外部 Worker、外部模块、WASM 文件加载一定成功。也不能反向夸大成“本地 HTML 不能执行任何 JS”或“所有本地资源都一律禁止”：不同资源类型和 API 的规则不同。
- 内嵌内容本身不需要读取旁置文件；Blob URL 表示运行时内存对象，不等于绕过限制去读取任意磁盘文件。
- `localhost` 或 HTTPS 验证成功不能代替真实 `file://` 验证。要求用户启动 HTTP 服务、改变浏览器安全开关，不符合当前交付约束。
- MDN 说明 module Worker 的模块通过 CORS 获取，而 classic Worker 的依赖使用 `importScripts()`。选择 classic 也不意味着其依赖自动离线：如果仍指向本地外部文件或 CDN，相关限制仍存在。[S4]

## 3. Blob classic Worker 与“内嵌 Worker”的准确含义

MDN Embedded workers 段明确说：

> “There is not an ‘official’ way to embed the code of a worker within a web page” [S3，原文使用双引号]

其示例将非执行 MIME 类型的 `<script>` 数据块文本组成 `Blob`，再用 `URL.createObjectURL(blob)` 创建 Worker。因此“内嵌 Worker”不是一种特殊的 HTML Worker 标签，而是从内嵌文本创建实际 Worker 的封装方式。[S3]

Worker 构造器的 `type` 原文：

> “The value can be `classic` or `module`. The default is `classic`.” [S4]

MDN 也说明 Blob URL 继承创建文档的 origin；若 CSP 限制 Worker，需要允许 Blob。Blob/data Worker 继承创建者 CSP 的情形另见 Using Web Workers。[S3、S4]

**仍待验证：** opaque file origin 下 Blob Worker 的实际启动、错误报告、Worker 内 API 可用性、CSP 与 object URL 生命周期。Worker 是另一个执行上下文，不直接访问页面 DOM；它能减轻主线程计算阻塞，但不会消除计算总量或整个浏览器进程的内存占用。[S3]

## 4. Structured clone 与 Transferable：只能局部避免复制

MDN 对 structured clone 的定义是：

> “The structured clone algorithm copies complex JavaScript objects.” [S5]

它遍历对象图，可处理循环引用；函数和 DOM 节点不能克隆，普通对象的原型链等信息不会完整保留。[S5]

对于 ArrayBuffer，MDN 写道：

> “the memory resource that it points to is literally moved between contexts in a fast and efficient zero-copy operation.” [S6，略去原文强调格式]

转移后原缓冲区 detached；TypedArray 可序列化但本身不是 transferable，转移的是其底层 `ArrayBuffer`。转移列表只指定如何发送资源，资源也必须能从消息载荷中访问到，单放进列表不会把它变成接收端可用的消息内容。[S6]

**推论及边界：**

- 把完整 JSON 对象图从主线程 `postMessage` 给 Worker，不能假定免费或没有第二份对象。
- 转移 ArrayBuffer 解决的是这一次跨上下文交接的缓冲区复制，不解决 Base64 解码、解压、文本解码、JSON 解析、索引构造、结果转换造成的其他分配。
- 转移不是共享；发送端不能继续使用原来的缓冲区。不能把这一机制描述成 SharedArrayBuffer，也不能由“zero-copy”推导整条数据处理链零复制。
- 少量查询结果传回页面可减少消息体积，但排序、聚合等是否需要扫描全数据仍取决于预处理及索引，尚未确定。

## 5. 压缩/解压 API：格式支持与 API 存在是两件事

MDN Compression Streams API 原文：

> “provides a JavaScript API for compressing and decompressing streams of data using the gzip or deflate formats.” [S7]

页面和构造器文档均标注可在 Workers 使用。`DecompressionStream(format)` 对不支持的格式抛出 `TypeError`。[S7、S8]

本次读取 MDN browser-compat-data，`CompressionStream` 和 `DecompressionStream` 基础接口均记录 Chrome 80、Firefox 113、Safari 16.4 开始支持；其他 Chromium 浏览器多使用 mirror 条目，不能把这些版本号直接复制给所有浏览器。`DecompressionStream` 的 `deflate` 条目也记录这三个版本。基础 API 的广泛支持不代表所有格式同样支持：例如其 `deflate-raw` 的 Chrome 条目为 103；当前构造器文档还列出 Brotli、Zstd，但不能因此把它们视为跨浏览器基线。[S8、S9]

**对 Python 预处理的含义：**Python 输出的 gzip、zlib 包装 deflate、raw deflate 必须与浏览器选定格式严格匹配。此处只确认机制，不选择最终格式。若目标浏览器不支持原生解压，内嵌 JS/WASM 解码器可以作为另一个待评估方向，但会新增 HTML 体积、初始化、兼容性和依赖审查成本，不在本调查中选库。

**分块边界：**要按需独立解压，分块必须具备可独立解码的边界；把一个整体压缩流任意切字节不能自动获得随机访问能力。这是压缩流与分块设计的推论，不是 Compression Streams 提供的索引能力。流式 API 也不保证最终消费方式流式：MDN 示例最终调用 `Response(...).blob()`，会形成完整输出 Blob；若再转完整文本、`JSON.parse`，仍会产生对应完整结果。[S7]

## 6. 为何虚拟列表和压缩不能消除整页载入/内存成本

以下是根据内嵌数据块、流 API、structured clone 行为做出的工程推论，不是浏览器内存倍率的实测结果。[S3、S5–S8、S12]

1. **虚拟列表限制的是可见行对应的 DOM 和渲染工作，不是 HTML 文件字节数。**数据仍全部位于同一文档中；首屏可以在文档完全读取前出现，但浏览器正常完成该文档载入时仍须消费后续内嵌内容。延迟解压不等于未把压缩载荷装入 HTML。
2. 非执行 `<script>` 数据块不会作为 JS 程序执行，但其文本仍属于 HTML 内容；“不会执行”不等于 HTML 解析器不读它，也不等于文本节点免费。具体浏览器是否另保留源文本、内部字符串如何表示，不能在没有实测时给统一倍数。
3. 若采用 Base64，编码文本长度约为压缩字节数的 4/3（另有少量填充）；这只是编码关系，不是本调查选定的存储方式，更不是总内存公式。
4. 处理时可能同时存在：HTML 中编码文本、解码出的压缩字节、解压字节、解码字符串、解析对象/列、索引、缓存、Worker 消息和当前展示结果。并不声称这些一定全部长期并存，但必须检查阶段性峰值。
5. 压缩缩小的是载荷的一种表示；解压后的信息量不会消失。若所有块最后都展开并永久缓存，分块也不会自动限制总驻留量。删除数据节点、释放引用或撤销 object URL 亦不保证操作系统立刻回收同等内存。
6. 全局筛选、排序、分组、跨侧匹配的代价，与屏幕上只画几十行是不同问题。预处理可移动一部分工作到 Python，但需要先明确哪些交互必须支持，不能预设全部查询已被预计算。

因此，既不能断言此规模一定失败，也不能宣称“虚拟列表 + 压缩 + Worker”已经保证百万行可用。

## 7. DuckDB-Wasm：仅作为可选研究对象

DuckDB 官方部署文档原文：

> “A DuckDB-Wasm deployment needs to access the following components:” [S10]

随后列出 Main Library Component、JS Worker Component、Wasm Worker Component、所需 DuckDB Extensions。官方说明 JS Worker 与 WASM 有匹配的 `mvp`、`eh`、`coi` 变体；模块路径通过 bundle 的 `mainModule` 告知库，WASM 建议以 `application/wasm` 提供。[S10]

实例化文档将 `mainModule` 与 `mainWorker` 交给异步数据库实例，调用 `db.instantiate(bundle.mainModule, bundle.pthreadWorker)`。其 CDN 示例虽然用 Blob 包装 Worker，却在 Blob 内执行 `importScripts` 加载 CDN Worker：**有 Blob 不等于已经离线自包含**。[S11]

线程版的官方边界：

> “The `coi` bundle runs multiple threads, which relies on `SharedArrayBuffer`.” [S10]

官方要求顶层文档通过 `Cross-Origin-Embedder-Policy: require-corp`、`Cross-Origin-Opener-Policy: same-origin` HTTP 响应头获得 cross-origin isolation。普通双击文件不提供这条 HTTP 部署路径，不能把 `coi` 的并行查询能力计入当前承诺；这不等于说非线程 `mvp`/`eh` 必然不可用。[S10]

扩展默认来自 `https://extensions.duckdb.org`；官方允许自建扩展仓库，但“内网镜像”仍不是“单文件零网络”。官方也警告默认设置可以访问远程端点。[S10]

**研究判断：**嵌入库、匹配 Worker、WASM 和实际所需扩展，再重定向其资产加载，机制上可以继续调查；上述官方部署示例没有提供“单 HTML + `file://` 全兼容”的证明。需单独核验 Blob WASM 加载/MIME、初始化路径、扩展是否自动加载、结果物化及 JS/WASM 内存。不能把 DuckDB-Wasm 视为默认选择，也不能从数据库引擎名推导规模性能保证。

## 8. 后续真实 `file://` 验证清单（本次未执行）

| 必须确认的边界 | 后续证据应包含什么 |
|---|---|
| 双击与完全离线 | 目标 OS/浏览器及版本，正常安全设置；断网、无缓存/干净配置下启动，确认无网络及旁置文件依赖 |
| Blob classic Worker | 从最终 HTML 内嵌文本创建、消息往返、异常路径、CSP、URL 撤销/释放；不能拿 HTTP 测试替代 |
| 解压 | 主线程/Worker 的接口可用性、准确格式、Python 产物互通、损坏/截断块、Unicode 与空块 |
| 所有权交接 | ArrayBuffer 转移后 detached、接收端可用，避免误转移仍被其他视图使用的底层缓冲区 |
| 文档启动与资源峰值 | 最终 HTML 大小、首次可交互、解析/解码/解压/建索引各阶段峰值；页面、Worker、WASM 合计，不只 DOM 数量 |
| 交互规模 | 在明确功能后测全局搜索、筛选、排序、跨侧比较；数据包含真实分布与长字符串，不能只测试均匀短记录 |
| 长时使用 | 切换块、清缓存、重复查询、取消操作后内存变化及失败提示；不以一次成功当作稳定性证明 |
| DuckDB（仅若仍被考虑） | 固定依赖版本，匹配变体，完全内嵌加载、无扩展外连，实际线程条件及 JS/WASM 峰值 |

仍需需求澄清：支持哪些浏览器/最低版本与设备内存；允许的 HTML 文件大小、启动时间及峰值内存；是否包含源码、行级明细；函数/文件跨侧匹配规则；哪些全局操作不可缺少。没有这些信息，本调查不会给性能验收线或最终架构。

## 一手来源索引

为便于复核，每条同时给官方发布页面及本次实际读取的官方仓库原文。

- **S1 WHATWG URL Standard — Origin**：[规范](https://url.spec.whatwg.org/#origin)；[原文](https://raw.githubusercontent.com/whatwg/url/main/url.bs)，`file` 分支。
- **S2 MDN Same-origin policy — File origins**：[页面](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy#file_origins)；[原文](https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/security/defenses/same-origin_policy/index.md)。
- **S3 MDN Using Web Workers**：[页面](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers#embedded_workers)；[原文](https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/api/web_workers_api/using_web_workers/index.md)，Embedded workers、Content security policy、数据传输和 DOM 限制段。
- **S4 MDN Worker() constructor**：[页面](https://developer.mozilla.org/en-US/docs/Web/API/Worker/Worker)；[原文](https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/api/worker/worker/index.md)。
- **S5 MDN Structured clone algorithm**：[页面](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm)；[原文](https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/api/web_workers_api/structured_clone_algorithm/index.md)。
- **S6 MDN Transferable objects**：[页面](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)；[原文](https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/api/web_workers_api/transferable_objects/index.md)。
- **S7 MDN Compression Streams API**：[页面](https://developer.mozilla.org/en-US/docs/Web/API/Compression_Streams_API)；[原文](https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/api/compression_streams_api/index.md)。
- **S8 MDN DecompressionStream()**：[页面](https://developer.mozilla.org/en-US/docs/Web/API/DecompressionStream/DecompressionStream)；[原文](https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/api/decompressionstream/decompressionstream/index.md)。
- **S9 MDN browser-compat-data**：[CompressionStream.json](https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/CompressionStream.json)；[DecompressionStream.json](https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/DecompressionStream.json)。版本值为本次读取快照，不是 file origin 专项认证。
- **S10 DuckDB Deploy**：[页面](https://duckdb.org/docs/stable/clients/wasm/deploying_duckdb_wasm)；[原文](https://raw.githubusercontent.com/duckdb/duckdb-web/main/docs/current/clients/wasm/deploying_duckdb_wasm.md)。
- **S11 DuckDB Instantiate**：[页面](https://duckdb.org/docs/stable/clients/wasm/instantiation)；[原文](https://raw.githubusercontent.com/duckdb/duckdb-web/main/docs/current/clients/wasm/instantiation.md)。
- **S12 MDN script element — type/data block**：[页面](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script#type)；[原文](https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/html/reference/elements/script/index.md)。
