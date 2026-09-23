# 系统架构

## 1. 架构目标

VV 使用“共享核心 + 平台适配器 + Provider 适配层”的架构。上层只处理测验、题目、答案、策略和验证结果，不感知 DOM、Android Accessibility Node 或 Windows UIA Element 的具体类型。

三个平台是平级适配器，不是三个独立产品：

```text
                         ┌─ WebAdapter: DOM / Accessibility / Coordinates
Shared Quiz Core ────────┼─ AndroidAdapter: Accessibility Tree
                         └─ WindowsAdapter: UI Automation Tree
```

Android Adapter 优先于 Windows Adapter 实现，但二者不预先绑定固定版本号。

## 2. 系统上下文

```text
统一任务面板
  │ 创建、暂停、恢复、停止、切换策略
  ▼
SessionManager
  │
  ├── QuizOrchestrator(session A) ──► PlatformAdapter(tab/app/device A)
  ├── QuizOrchestrator(session B) ──► PlatformAdapter(tab/app/device B)
  └── waiting sessions

每场 QuizOrchestrator：
Platform Observation
  → QuizSession + QuestionFrame[] + LocatorMap[]
  → QuestionBatch[]
  → SolverProvider
  → AnswerResult[]
  → Executor
  → Verifier
  → Retry / Advance / Submit / Complete
```

远端信任边界包括用户选择的模型 Provider 及其原生搜索服务。网页、应用内容、图片、搜索结果和模型输出均视为不可信数据。

## 3. 分层

### 3.1 共享核心层

包含：

- QuizSession 和题目生命周期。
- QuestionBatch 规划与逐题结果关联。
- 双运行策略、限时收尾、答错重试和模型故障规则。
- ObservationValidator、AnswerValidator、Executor 计划与 Verifier 协议。
- SessionManager、调用额度、并发队列和临时总结。

共享核心不得导入平台原生节点类型，不保存跨会话的题目或定位信息。

### 3.2 平台适配层

统一职责：

```text
capabilities()
waitUntilReady()
observeSession()
resolveTarget()
executeNativeAction()
readState()
captureVisualRegion()
```

平台实现：

| 平台 | 观察来源 | 主要动作 | 特有风险 |
|---|---|---|---|
| Web | DOM、可访问树、截图 | click、input、select、scroll | 动态 DOM、iframe、Canvas、导航 |
| Android | Accessibility Tree、截图 | click、setText、scroll | 节点复用、前后台、系统权限 |
| Windows | UI Automation Tree、截图 | Invoke、Toggle、Value、Scroll | 窗口焦点、Pattern 差异、权限 |

统一的是语义，不要求三个平台具有相同的控件模型或验证信号。能力不匹配时显式降级或暂停。

### 3.3 模型提供层

采用 Vercel AI SDK 作为底层统一接口，VV 的 `SolverProvider` 负责：

- 把 QuestionBatch 转为统一求解输入。
- 约束逐题结构化输出。
- 把 Provider 差异转换为能力声明。
- 处理 Provider 原生视觉、结构化输出和网页搜索。
- 分类错误并应用每场调用上限。

ProviderManager 在本地维护多个 Provider Profile。每场测验选择一个 Profile 和模型；不会在运行中自动路由或切换模型。

### 3.4 展示层

统一任务面板展示：

- 所有运行中、暂停、排队和已完成但尚未关闭的会话。
- 目标标签页/应用/设备、运行策略、Provider、模型、调用次数和剩余时间。
- 暂停、继续、停止、切换策略和跳转目标。
- 临时会话总结与注意事项。

面板不直接操作平台，只向 SessionManager 和 QuizOrchestrator 发命令。

## 4. QuizSession 与批处理

`QuizSession` 是整场答题的一等对象，适用于：

- 逐题页面：会话每次只出现一个活动 QuestionFrame，ADVANCE 后追加下一题。
- 整页试卷：一次观察得到多个 QuestionFrame，并在统一提交前维护每题状态。

QuestionBatch 只影响模型调用效率，不改变每题独立性：

- 批次包含明确的 question_id 列表。
- AnswerResult 按 question_id 返回。
- 单题失败只重试该题或包含该题的新批次。
- 已执行并验证的题目不因其他题失败而重复操作。

## 5. 核心接口草案

```text
interface PlatformAdapter {
  capabilities(): PlatformCapabilities
  waitUntilReady(context, signal): Promise<ReadinessResult>
  observeSession(context, signal): Promise<SessionObservation>
  execute(plan, locatorMap, signal): Promise<ActionResult[]>
  readState(context, signal): Promise<PlatformState>
  captureVisualRegion(target, signal): Promise<VisualFrame>
}

interface SolverProvider {
  capabilities(profile, model): Promise<SolverCapabilities>
  listModels(profile): Promise<ModelCatalogResult>
  solve(batch, policy, signal): Promise<BatchAnswerResult>
}

interface Verifier {
  verify(before, actions, after, policy): Promise<VerificationResult>
}
```

原生动作由 PlatformAdapter 完成；共享 Executor 只负责从有效答案建立动作计划并执行策略授权。

## 6. 能力协商

能力至少覆盖：

```text
question_types
multi_question_page
text_input
image_input
structured_output
native_web_search
semantic_targeting
coordinate_targeting
submit
advance
grading_feedback
timer_observation
```

缺少能力时：

- 监督模式暂停并说明缺失能力。
- 无人值守只有在仍可形成有效动作时才降级；模型不可用、权限不足和无法定位不以猜测替代。

## 7. 观察降级链

Web 的顺序为：

```text
通用 DOM/可访问树
  → 项目内置站点适配器
  → 题目原图或区域截图的视觉理解
  → Canvas 坐标目标（1.2.0）
  → 暂停
```

站点适配器随项目更新发布，不允许绕过核心校验、运行策略或权限。模型不得临时生成并执行站点脚本或规则。

## 8. 并发与生命周期

- 默认最多 3 个活动会话，用户可配置。
- 超出并发上限的会话排队。
- 每个会话有独立的调用次数上限，默认 300。
- 同一目标标签页/应用/设备同一时间最多一个活动会话。
- 用户手动操作目标时，该会话暂停并重新观察。
- 无人值守在控制面板关闭后继续；监督模式暂停。
- 页面导航、应用切换或节点树替换使受影响定位信息失效。

## 9. Provider 架构

Provider Profile 包含 Provider 类型、Endpoint、API Key 引用、模型目录和能力缓存。用户可新增、编辑和删除多个 Profile。

模型目录策略：

1. Provider 支持列举模型时自动读取。
2. SDK 有静态模型信息时作为辅助展示，不当作唯一事实来源。
3. 无法列举时允许手动输入模型 ID。
4. 每场测验明确选择 Profile 与模型。

Provider 原生搜索是可选能力。只有 Provider 明确支持、用户已开启且模型决定需要时才使用；VV 不提供独立 SearchProvider、MCP 搜索或搜索后端。

## 10. 视觉坐标动作

Canvas 或无语义控件页面可以通过 VisualFrame 产生坐标目标。两种运行策略都允许执行，但必须：

- 坐标绑定截图、窗口/视口尺寸和观察时间。
- 点击前重新确认目标区域未发生明显变化。
- 限制动作类型和区域，禁止模型输出任意脚本。
- 点击后立即重新观察并 VERIFY。
- 页面变化或验证不明时停止继续坐标动作。

坐标动作的可靠性低于语义定位，运行总结需单独统计。

## 11. 故障隔离

- Provider 网络故障：默认重试 3 次，持续失败则暂停对应会话，不自动换模型。
- 单题求解失败：不影响同批其他题；按策略重试、暂停、猜答或跳过。
- 单场页面故障：不影响其他并行会话。
- 控制面板故障：运行状态保留在扩展后台；监督会话暂停，无人值守会话按策略继续。
- 浏览器/扩展重启：不恢复旧题目或 LocatorMap，避免持久化敏感运行数据。

## 12. 架构决策摘要

- 三个平台是平级 PlatformAdapter；Android 优先于 Windows。
- QuizSession 是整场测验边界，QuestionFrame 是单题边界。
- Vercel AI SDK 是统一 Provider 基础，OpenAI Compatible 覆盖长尾服务。
- 两种运行策略均为全自动。
- Canvas 坐标动作是明确接受的受验证降级。
- 原生搜索由 Provider 提供，VV 不自建搜索层。
- 多任务通过 SessionManager 隔离和调度。
- 训练、题库、遥测和永久运行记录不属于运行时架构。

