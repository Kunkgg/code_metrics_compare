# 18: 安装后的完整报告生成

**What to build:** 生成者从 wheel 安装后，在源码仓库之外生成并阅读完整离线报告。

**Blocked by:** 17：离线安全与失败兜底

Status: ready-for-agent

依据：[正式产品化规格](../spec.md)及其中引用的最新 PRD／ARCHITECTURE。沿用 GLOSSARY 术语；本票编号采用用户确认的24票拆分，替代规格中12项里程碑的任务编号引用。

- [ ] 构建并安装正式 wheel；HTML、CSS、脚本、Schema、指标名称及已注册 profile 通过包资源读取，不依赖源码相对目录。
- [ ] 仓库外运行 generate／validate／report 的适用流程，生成 HTML 并断网打开全部已实现业务入口。
- [ ] 验证元信息参数、profile 选择、正常／受限退出码、覆盖保护及输出位置日志。
- [ ] 记录实际锁定依赖和构建版本，保存安装、生成及浏览器检查结果；正式入口不导入原型模块。
