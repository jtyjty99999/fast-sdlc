import type { GateMode, KnowledgeType, WorkflowStatus } from '@autosdd/shared';

export interface SeedSkill {
  name: string;
  category: string;
  description: string;
  instructionsMd: string;
}

export interface SeedKnowledge {
  title: string;
  type: KnowledgeType;
  contentMd: string;
  tags: string[];
}

export interface SeedAgent {
  name: string;
  role: string;
  description: string;
  systemPrompt: string;
  skills: string[];
  knowledge: string[];
}

export interface SeedStep {
  stepKey: string;
  name: string;
  agentName: string;
  instructionMd: string;
  dependsOn: string[];
  gateMode?: GateMode;
}

export interface SeedWorkflow {
  name: string;
  description: string;
  scenario: string;
  tags: string[];
  matchKeywords: string[];
  status: WorkflowStatus;
  steps: SeedStep[];
}

export interface SeedCompletedTask {
  title: string;
  description: string;
  scenario: string;
  workflowName: string;
  outputs: Record<string, string>;
}

export interface SeedQueuedTask {
  title: string;
  description: string;
  scenario: string;
  workflowName: string;
}

export const SEED_SKILLS: SeedSkill[] = [
  {
    name: '需求澄清',
    category: '需求',
    description: '用结构化提问把模糊诉求收敛成可讨论的需求边界',
    instructionsMd: `## 使用时机
当任务描述缺少用户、场景、成功标准时使用。

## 步骤
1. 用一句话复述目标，确认没有理解偏差。
2. 按「用户 / 场景 / 触发 / 期望结果」四要素补齐信息。
3. 区分 Must / Should / Won't，明确本期不做什么。
4. 列出需要业务方确认的开放问题，每条都给出建议默认值。

## 输出要求
- 用表格列出开放问题、影响范围与建议默认值。
- 不要替业务方拍板，把假设显式写出来。`,
  },
  {
    name: 'EARS 规格编写',
    category: '需求',
    description: '用 EARS 句式编写可验收的需求规格',
    instructionsMd: `## EARS 句式
- Ubiquitous：系统应……
- Event-driven：当……时，系统应……
- State-driven：在……状态下，系统应……
- Unwanted：如果……，系统应……

## 要求
- 每条规格只表达一个可验证的行为。
- 验收标准必须能转写成测试用例。
- 为异常路径单独编写规格，不要只写主流程。
- 所有不确定的数值给出待确认标记。`,
  },
  {
    name: '领域建模',
    category: '架构',
    description: '识别聚合、实体与不变量，给出边界清晰的领域模型',
    instructionsMd: `## 建模步骤
1. 从需求中提取名词，区分实体、值对象与事件。
2. 围绕事务一致性划定聚合边界，聚合之间只通过 ID 引用。
3. 为每个聚合列出不变量与状态迁移。
4. 标注跨聚合流程，说明最终一致性的补偿方式。

## 输出
- 实体清单（名称、职责、关键字段）
- 状态机（状态、事件、迁移条件）
- 风险点（竞态、幂等、数据膨胀）`,
  },
  {
    name: 'API 契约设计',
    category: '架构',
    description: '定义稳定的请求/响应契约与错误语义',
    instructionsMd: `## 设计规范
- 资源命名使用复数名词，动作用 HTTP 方法表达。
- 请求与响应都带版本化字段，禁止直接暴露数据库行。
- 错误统一为 \`{ code, message, details }\`，code 稳定可枚举。
- 写操作必须考虑幂等键与重复提交。
- 分页使用游标而非偏移量，返回 nextCursor。

## 输出
给出接口表、请求/响应示例、错误码表，以及兼容性说明。`,
  },
  {
    name: 'TDD 开发',
    category: '开发',
    description: '先写失败测试，再写最小实现，最后重构',
    instructionsMd: `## 循环
1. RED：写一个描述期望行为的测试，运行并确认失败。
2. GREEN：写最小实现让测试通过，不做额外设计。
3. REFACTOR：在测试保护下消除重复、改善命名。

## 约束
- 测试名描述行为，不描述实现。
- 一个测试只断言一个行为。
- 业务规则用纯函数表达，I/O 放在边界层。
- 提交前确保类型检查与全部测试通过。`,
  },
  {
    name: '单元测试生成',
    category: '测试',
    description: '围绕边界与异常路径补齐测试',
    instructionsMd: `## 覆盖清单
- 正常路径：最小合法输入 → 期望输出。
- 边界：空值、最大长度、零值、重复值。
- 异常：依赖超时、非法输入、并发冲突。
- 幂等：同一请求重复执行结果一致。

## 输出
按 Arrange-Act-Assert 组织用例，列出未覆盖的风险点。`,
  },
  {
    name: '代码评审清单',
    category: '质量',
    description: '按安全、正确性、可维护性三层检查改动',
    instructionsMd: `## 检查顺序
1. 安全：输入校验、权限边界、密钥与日志脱敏。
2. 正确性：状态迁移、并发竞态、错误处理、回滚。
3. 可维护性：命名、职责单一、重复逻辑、测试覆盖。

## 输出格式
- 结论：通过 / 有条件通过 / 阻塞
- 问题列表：严重级别、文件位置、建议修改
- 必须修复项与可后续跟进项分开列出`,
  },
  {
    name: '发布说明撰写',
    category: '写作',
    description: '面向使用者的变更说明与升级指引',
    instructionsMd: `## 结构
1. 一句话概述本次发布的价值。
2. 新增能力：用户能感知到的变化。
3. 行为变更：可能影响现有用法的点。
4. 修复列表与已知问题。
5. 升级步骤与回滚方式。

## 要求
用用户语言描述，不写内部实现细节；每条变更都可追溯到需求或缺陷编号。`,
  },
  {
    name: '技术文档撰写',
    category: '写作',
    description: '面向开发者的功能文档、接口说明与操作指引',
    instructionsMd: `## 结构
1. 概述：功能解决什么问题、适合谁。
2. 快速开始：最短可运行的示例。
3. 核心概念：关键术语、字段与状态。
4. 接口说明：请求/响应示例与错误码。
5. 常见问题与已知限制。

## 要求
- 每个关键结论标注来源（需求 / 架构 / 实现 / 测试）。
- 示例必须可复制运行，避免无说明的占位符。
- 不臆造上下文中未出现的字段与行为；假设显式标注。`,
  },
];

export const SEED_KNOWLEDGE: SeedKnowledge[] = [
  {
    title: '项目宪法',
    type: 'RULE',
    contentMd: `1. 所有外部输入必须在边界层用 schema 校验，非法输入返回 400 与字段级错误。
2. 状态变化只能通过显式状态机，禁止任意赋值。
3. 多表写入必须放在事务中。
4. 任何失败路径都必须有稳定错误码与用户可理解的提示。
5. 新增业务逻辑必须附带测试，核心路径覆盖率不低于 80%。`,
    tags: ['规范', '工程'],
  },
  {
    title: '业务术语表',
    type: 'BUSINESS',
    contentMd: `- 行程（Trip）：乘客从上车到下车的一次完整服务。
- 行程分享（Trip Share）：把行程实时位置通过链接分享给第三方。
- 入账（Settlement）：支付成功后生成账务流水的动作。
- 重复入账：同一支付回调被处理多次，产生多条账务流水。
- 卡点（Gate）：工作流中需要人工确认才能继续的步骤。`,
    tags: ['术语', '业务'],
  },
  {
    title: '历史 Bad Case：重复回调',
    type: 'LESSON',
    contentMd: `2025 年 3 月，支付回调因网络重试被重复消费，导致 37 笔订单重复入账。
根因：回调处理没有幂等键，且数据库唯一索引只建在自增主键上。
修复：以支付单号作为唯一键，处理前先插入幂等记录，冲突时直接返回成功。
教训：所有外部回调都必须按“至少一次投递”设计。`,
    tags: ['复盘', '支付'],
  },
  {
    title: 'REST API 规范',
    type: 'API',
    contentMd: `- 基础路径：/api/v1
- 分页：?limit=&cursor=，响应包含 nextCursor 与 hasMore
- 时间：ISO 8601 UTC 字符串
- 错误体：{ code, message, details? }
- 写接口：支持 Idempotency-Key 请求头
- 废弃策略：先标注 deprecated，至少保留两个版本周期`,
    tags: ['API', '规范'],
  },
  {
    title: '错误码规范',
    type: 'API',
    contentMd: `- VALIDATION_ERROR：输入不合法
- NOT_FOUND：资源不存在
- CONFLICT：状态冲突，如重复提交
- RUN_IN_PROGRESS：任务已有进行中的执行
- APPROVAL_NOT_PENDING：审批已被处理
- WORKFLOW_INVALID：工作流结构非法
- LLM_NOT_CONFIGURED：未配置模型凭据
- INTERNAL：未预期的服务端错误，禁止透出内部细节`,
    tags: ['API', '错误码'],
  },
  {
    title: '前端设计规范',
    type: 'RULE',
    contentMd: `- 基准字号 13px，正文行高 1.6。
- 主色 #002FA7，仅用于主要操作与选中态。
- 状态色：成功 #0f7b6c、警告 #b45309、审批 #7e22ce、失败 #b91c1c。
- 圆角 10px，阴影克制，优先使用分隔线建立层级。
- 所有异步操作必须有加载态、空态与错误态。
- 不可逆操作必须二次确认。`,
    tags: ['前端', '设计'],
  },
  {
    title: '测试数据规范',
    type: 'BUSINESS',
    contentMd: `- 禁止使用真实用户手机号与身份证号。
- 手机号统一使用 138000000xx 段。
- 金额使用整数分存储，测试金额不超过 10000 分。
- 时间相关测试必须注入时钟，禁止依赖真实时间。
- 每个用例独立准备数据，禁止跨用例共享可变状态。`,
    tags: ['测试', '数据'],
  },
  {
    title: '部署环境说明',
    type: 'MEMORY',
    contentMd: `- 开发环境：本机 SQLite，服务默认监听 127.0.0.1:4000。
- 预发环境：独立数据库，禁止连接生产下游。
- 生产发布：灰度 10% → 观察 30 分钟 → 全量。
- 回滚：保留上一版本镜像，数据库迁移必须向前兼容。
- 监控：关注错误率、P99 延迟、任务失败率三个指标。`,
    tags: ['部署', '运维'],
  },
];

export const SEED_AGENTS: SeedAgent[] = [
  {
    name: '需求分析师',
    role: '业务需求分析师',
    description: '负责把模糊诉求转写为可验收的需求规格，识别范围与开放问题。',
    systemPrompt:
      '你是一位严谨但不失同理心的需求分析师。你优先澄清目标与边界，不替业务方做假设；所有不确定项都显式列出。',
    skills: ['需求澄清', 'EARS 规格编写'],
    knowledge: ['项目宪法', '业务术语表'],
  },
  {
    name: '系统架构师',
    role: '系统架构师',
    description: '负责领域建模、技术选型与接口契约，确保方案可落地、可演进。',
    systemPrompt:
      '你是一位注重权衡的架构师。每个技术决策都要说明理由、代价与替代方案，避免过度设计。',
    skills: ['领域建模', 'API 契约设计'],
    knowledge: ['项目宪法', 'REST API 规范'],
  },
  {
    name: '开发工程师',
    role: '后端开发工程师',
    description: '按契约实现功能，以测试驱动开发，保证错误处理与可维护性。',
    systemPrompt:
      '你是一位务实的开发工程师。先让测试失败，再写最小实现；不做未被要求的抽象，不留下调试代码。',
    skills: ['TDD 开发', '单元测试生成'],
    knowledge: ['项目宪法', '错误码规范', '部署环境说明'],
  },
  {
    name: '测试工程师',
    role: '质量保障工程师',
    description: '设计并执行验证方案，覆盖边界、异常与并发场景，给出可行动的质量结论。',
    systemPrompt:
      '你是一位以风险为导向的测试工程师。优先验证会伤害用户和资金的路径，结论必须可复现。',
    skills: ['单元测试生成', '需求澄清'],
    knowledge: ['测试数据规范', '历史 Bad Case：重复回调'],
  },
  {
    name: '代码评审员',
    role: '高级代码评审员',
    description: '从安全、正确性、可维护性三个维度评审改动，给出明确结论。',
    systemPrompt:
      '你是一位严格但建设性的评审员。按严重级别列出问题，区分必须修复与可以后续跟进的事项。',
    skills: ['代码评审清单'],
    knowledge: ['项目宪法', '错误码规范', '历史 Bad Case：重复回调'],
  },
  {
    name: '技术写作者',
    role: '技术文档工程师',
    description: '把技术变更转写为用户可理解的发布说明与操作指引。',
    systemPrompt:
      '你是一位面向读者的技术写作者。用用户语言表达价值与影响，避免内部实现细节与营销腔。',
    skills: ['发布说明撰写'],
    knowledge: ['业务术语表', '前端设计规范'],
  },
  {
    name: '文档专家',
    role: '技术文档专家',
    description: '把需求、架构与实现产物整理成可交付的功能文档，让读者能独立使用与排查。',
    systemPrompt:
      '你是一位以读者为中心的技术文档专家。只写上下文中有依据的内容，结构清晰、示例可运行，并显式标注假设与限制。',
    skills: ['技术文档撰写', '发布说明撰写'],
    knowledge: ['业务术语表', 'REST API 规范', '前端设计规范'],
  },
];

export const SEED_WORKFLOWS: SeedWorkflow[] = [
  {
    name: '新功能开发',
    description: '从需求分析到代码评审的完整交付链路，编码与评审后设置人工卡点。',
    scenario: '新功能开发',
    tags: ['feature', '需求'],
    matchKeywords: ['新功能', '需求', '开发', '上线', '功能', '新增'],
    status: 'ENABLED',
    steps: [
      {
        stepKey: 'requirement',
        name: '需求分析',
        agentName: '需求分析师',
        instructionMd:
          '输出需求规格：目标用户、使用场景、范围边界、用户故事与可验收标准，并列出待确认问题。',
        dependsOn: [],
      },
      {
        stepKey: 'architecture',
        name: '架构设计',
        agentName: '系统架构师',
        instructionMd:
          '基于需求规格给出领域模型、关键设计决策与接口契约，说明风险与缓解方案。',
        dependsOn: ['requirement'],
      },
      {
        stepKey: 'implementation',
        name: '编码实现',
        agentName: '开发工程师',
        instructionMd:
          '按接口契约给出实现方案：核心流程、状态处理、错误码与自测记录。完成后需要人工确认。',
        dependsOn: ['architecture'],
        gateMode: 'HUMAN_APPROVAL',
      },
      {
        stepKey: 'verification',
        name: '质量验证',
        agentName: '测试工程师',
        instructionMd: '设计并执行验证方案，覆盖主路径、边界、异常与幂等场景，输出测试报告。',
        dependsOn: ['implementation'],
      },
      {
        stepKey: 'review',
        name: '代码评审',
        agentName: '代码评审员',
        instructionMd:
          '按安全、正确性、可维护性评审实现与验证结果，给出通过/阻塞结论与必须修复项。',
        dependsOn: ['verification'],
        gateMode: 'HUMAN_APPROVAL',
      },
    ],
  },
  {
    name: 'Bug 修复',
    description: '定位、修复、回归验证三段式，适用于线上缺陷与故障处理。',
    scenario: 'Bug修复',
    tags: ['bug', '修复'],
    matchKeywords: ['bug', '报错', '异常', '修复', '故障', '重复', '线上'],
    status: 'ENABLED',
    steps: [
      {
        stepKey: 'locate',
        name: '问题定位',
        agentName: '开发工程师',
        instructionMd:
          '基于现象与日志还原时间线，给出根因假设、验证方式与影响范围，不要直接开始改代码。',
        dependsOn: [],
      },
      {
        stepKey: 'fix',
        name: '修复实现',
        agentName: '开发工程师',
        instructionMd: '针对确认的根因给出最小修复方案，说明为什么不会引入回归。',
        dependsOn: ['locate'],
      },
      {
        stepKey: 'regression',
        name: '回归验证',
        agentName: '测试工程师',
        instructionMd: '编写回归用例，验证修复有效且未影响相邻功能，输出验证结论。',
        dependsOn: ['fix'],
      },
    ],
  },
  {
    name: '代码评审',
    description: '对已有改动做静态评审并形成结论，适合合并前的质量把关。',
    scenario: '代码评审',
    tags: ['review', '质量'],
    matchKeywords: ['评审', 'review', '代码质量', '合并', 'PR'],
    status: 'ENABLED',
    steps: [
      {
        stepKey: 'static-review',
        name: '静态评审',
        agentName: '代码评审员',
        instructionMd: '按检查清单评审改动的安全、正确性与可维护性，标注问题级别。',
        dependsOn: [],
      },
      {
        stepKey: 'conclusion',
        name: '评审结论',
        agentName: '代码评审员',
        instructionMd: '汇总问题，给出通过/有条件通过/阻塞的结论与必须修复项。',
        dependsOn: ['static-review'],
      },
    ],
  },
  {
    name: '代码文档编写与评审',
    description:
      '以任务中提供的代码为唯一事实来源编写文档，再由架构师逐项对照代码评审，确保文档不偏离实现。',
    scenario: '文档编写',
    tags: ['docs', '文档'],
    matchKeywords: ['文档', '代码文档', '接口文档', '说明文档', 'README', '注释'],
    status: 'ENABLED',
    steps: [
      {
        stepKey: 'documentation',
        name: '文档编写',
        agentName: '文档专家',
        instructionMd:
          '以任务描述中提供的代码为唯一事实来源（文件路径、接口签名、数据结构、默认值、错误码与示例），编写文档：概述、模块结构、调用流程、对外接口、请求/响应字段、错误处理、配置项与已知限制。代码中无法确认的内容标注「待确认」，不得臆造字段或行为。',
        dependsOn: [],
      },
      {
        stepKey: 'documentation-review',
        name: '文档评审',
        agentName: '系统架构师',
        instructionMd:
          '逐项对照任务中提供的代码与文档：接口路径、字段、默认值、错误码、调用顺序与示例是否一致，是否遗漏关键约束或过度承诺。给出通过/修改结论与必须修改项。',
        dependsOn: ['documentation'],
      },
    ],
  },
];

export const SEED_COMPLETED_TASK: SeedCompletedTask = {
  title: '为打车应用增加“行程分享”能力',
  description:
    '乘客在行程进行中可以把实时位置分享给家人，分享链接 24 小时有效，家人无需安装应用即可查看。需要覆盖分享创建、权限控制与链接失效。',
  scenario: '新功能开发',
  workflowName: '新功能开发',
  outputs: {
    requirement: `# 需求规格：行程分享

## 目标
让乘客在行程中把实时位置安全地分享给家人，降低独自出行时的担忧。

## 范围
- 本期：创建分享链接、查看分享页、链接 24 小时自动失效、手动取消分享。
- 不做：多人协作编辑、历史行程批量分享、应用内好友关系。

## 用户故事与验收标准
1. 作为乘客，我可以在行程详情页一键生成分享链接。
   - 链接包含不可猜测的令牌，默认 24 小时有效。
2. 作为家人，我打开链接无需登录即可查看位置与预计到达时间。
   - 行程结束后页面展示“行程已结束”，不再暴露实时位置。
3. 作为乘客，我可以随时取消分享。
   - 取消后链接立即失效，再次访问返回 410。

## 待确认
- 是否需要限制单个行程的最大分享次数？建议默认 5 次。
- 分享页是否需要展示司机信息？建议仅展示脱敏后的车牌尾号。`,
    architecture: `# 架构设计：行程分享

## 领域模型
- TripShare（聚合根）：id、tripId、token、createdBy、expiresAt、revokedAt。
- 不变量：token 全局唯一；过期或撤销后不可再访问；同一行程最多 5 个有效分享。

## 关键决策
| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 令牌生成 | 128 位随机数 + Base62 | 不可枚举，链接短 |
| 存储 | 关系表 + token 唯一索引 | 查询简单，天然防重 |
| 权限 | 分享页只读，按 token 鉴权 | 无需登录，降低使用门槛 |
| 过期 | 读取时校验 + 定时清理 | 双重保障 |

## 接口契约
- \`POST /api/trips/{tripId}/shares\` → 201 \`{ shareId, url, expiresAt }\`
- \`GET /api/shares/{token}\` → 分享视图；过期返回 410
- \`DELETE /api/shares/{shareId}\` → 204

## 风险
- 令牌泄露：限制访问频率，日志脱敏。
- 行程结束后缓存未失效：分享视图不缓存，或缓存 TTL ≤ 30 秒。`,
    implementation: `# 实现说明：行程分享

## 核心链路
1. 校验行程归属与状态，仅进行中的行程允许创建分享。
2. 生成 128 位随机令牌，写入 trip_shares，token 建唯一索引。
3. 分享页按 token 查询，校验 expiresAt 与 revokedAt，返回脱敏视图。
4. 取消分享写入 revokedAt，后续访问统一返回 410。

## 改动点
- 新增 \`shares\` 路由与 \`shareService\`，状态判断集中在领域函数。
- 令牌生成封装为 \`createShareToken()\`，便于审计与替换。
- 分享视图不返回司机手机号，车牌仅保留尾号。

## 自测
\`\`\`
✓ 正常创建返回 201 与 24 小时过期时间
✓ 同一行程第 6 个分享被拒绝
✓ 过期 token 返回 410
✓ 取消后立即失效
✓ 无权限行程返回 404
\`\`\`

## 已知限制
- 首版未做分享访问审计报表。
- 令牌轮换策略后续补充。`,
    verification: `# 测试报告：行程分享

## 覆盖范围
主路径、权限、过期、撤销、并发创建与频率限制。

## 结果
| 编号 | 场景 | 预期 | 结果 |
| --- | --- | --- | --- |
| S-01 | 进行中行程创建分享 | 201 且过期时间为 24h | 通过 |
| S-02 | 非本人行程创建 | 404 | 通过 |
| S-03 | 第 6 个有效分享 | 409 | 通过 |
| S-04 | 过期 token 访问 | 410 | 通过 |
| S-05 | 撤销后访问 | 410 | 通过 |
| S-06 | 并发创建 10 次 | 最多 5 个有效分享 | 通过 |

## 风险提示
- 分享页缓存策略需要在预发环境再验证一次。
- 建议补充弱网下重复点击的前端防抖。

## 结论
质量达标，可以进入评审。`,
    review: `# 代码评审结论：行程分享

## 结论
**有条件通过**。核心实现正确，有 2 项需要在合入前处理。

## 必须修复
1. 分享视图的缓存头缺失，存在行程结束后仍展示位置的风险。
2. 令牌生成未使用常量时间比较，建议统一封装校验函数。

## 建议
- 将“有效分享数量”检查下沉到数据库唯一约束或事务，避免并发边界。
- 为 410 响应补充明确错误码，便于前端区分。

## 复核结果
两项必须修复已完成并补充测试，同意合入。`,
  },
};

export const SEED_QUEUED_TASKS: SeedQueuedTask[] = [
  {
    title: '修复支付回调偶发重复入账',
    description:
      '线上监控发现同一支付回调在重试时被处理两次，导致重复入账。需要定位根因、给出修复并完成回归验证。',
    scenario: 'Bug修复',
    workflowName: 'Bug 修复',
  },
  {
    title: '为支付回调幂等模块补齐代码文档',
    description: `代码位置：apps/server/src/payment/callback.ts

export async function handlePaymentCallback(payload: PaymentCallback): Promise<Result> {
  // 以支付单号做幂等键，重复回调直接返回 success
  const inserted = await idempotency.insertIfAbsent(payload.paymentNo);
  if (!inserted) return { success: true, duplicated: true };
  await settlement.record(payload);
  return { success: true, duplicated: false };
}

接口：POST /api/v1/payments/callback
请求体：{ paymentNo: string; amount: number; paidAt: string }
错误码：IDEMPOTENCY_CONFLICT、SETTLEMENT_FAILED
配置：PAYMENT_CALLBACK_TIMEOUT_MS（默认 3000）

请只依据以上代码与接口信息编写文档，覆盖模块职责、调用流程、请求字段、幂等语义、错误处理与配置项；无法从代码确认的内容标注「待确认」。`,
    scenario: '文档编写',
    workflowName: '代码文档编写与评审',
  },
];
