# 安全与边界

> 所属：[AutoSDD 设计文档](README.md)
> 相关：[产品定位](01-product.md) · [远程沙箱设计](11-sandbox.md)

---

## 安全与边界

| 风险 | 措施 |
|---|---|
| 未授权访问 | 默认绑定 `127.0.0.1`；文档明确「无鉴权，勿公网暴露」 |
| API Key 泄露 | 只在服务端读取（模型记录或环境变量）；公开接口仅返回来源；错误信息脱敏；日志不输出 Key |
| Markdown XSS | `react-markdown` 默认不渲染 HTML；不启用 `rehype-raw` |
| Prompt 注入 | 任务/知识文本以明确分隔段注入；声明为数据而非指令；不构成安全边界，文档说明 |
| 请求体过大 | Fastify `bodyLimit = 1MB`；各文本字段长度上限（zod） |
| 超时/挂死 | 每步 `AbortSignal` 超时（默认 300s，可配置）；死锁检测 |
| 并发写竞争 | `node:sqlite` 同步 + 单进程；条件 UPDATE + 事务 |
| 重跑污染 | 每次 run 冻结 snapshot；旧 run 只读 |
| 日志泄露 | 不记录完整 prompt 到控制台日志；context 仅存 DB 供本地查看 |

