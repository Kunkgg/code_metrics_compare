# 01: 最小离线报告：文件代码行变化

**What to build:** 报告生成者通过正式 report 入口读取模拟扫描对，生成一个可断网阅读的 HTML；阅读者能够识别基线／当前并查看文件代码行变化。

**Blocked by:** None (can start immediately)

Status: ready-for-agent

依据：[正式产品化规格](../spec.md)及其中引用的最新 PRD／ARCHITECTURE。沿用 GLOSSARY 术语；本票编号采用用户确认的24票拆分，替代规格中12项里程碑的任务编号引用。

- [ ] 提供 build_report(BuildRequest) -> BuildResult 及 report 命令；必填 baseline、current、output，既有 generate／validate 行为保持兼容。
- [ ] 模拟 profile 通过明确的输入适配进入正式分析和封装；不导入原型生成器、不依赖压力数据 manifest；文件代码行原值及差值符合独立预期。
- [ ] HTML 内嵌运行资产和必要数据；登记的 macOS／Chrome 可断网 file:// 打开，交互及预生成静态概览均可查看本切片结果。
- [ ] 可选两侧元信息显示为用户提供、未验证；未提供时不从文件名推断。局部交付明确列出本阶段已覆盖能力，不宣称全部业务或验收完成。
- [ ] 输出禁止覆盖输入；既有输出默认拒绝覆盖，显式 --force 才替换；临时产物经检查后原子发布。
- [ ] 通过公开构建入口生成实际 HTML，核对正常文件变化及空输入场景；保留正式源码、输入和产物摘要。
