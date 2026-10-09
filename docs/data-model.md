# 数据结构

数据定义以 `src/core/schema.ts`、`src/core/platform.ts`、`src/core/orchestrator.ts` 和 `src/core/course.ts` 为准。结构化输入输出通过 Zod 校验。核心题目协议的 `schema_version` 为 `1.0`，产品版本为 `1.2.0`。

## 题目和答案

| 对象 | 内容和约束 |
| --- | --- |
| `QuestionFrame` | 会话、题目、观察 ID；单选、多选或填空类型；题干、选项、填空、选择数量限制及内容来源 |
| `MediaRef` | 图片 ID、用途、来源、尺寸、媒体类型和临时句柄 |
| `QuestionBatch` | 一次模型求解包含的题目及共享上下文；批次关联以实际题目 ID 校验 |
| `AnswerResult` | 当前题目的结构化答案；选择项引用已有选项 ID，填空值引用已有填空 ID |
| `BatchAnswerResult` | 一组按题目 ID 关联的答案；检查重复、缺失、未知题目及题型一致性 |
| `LocatorMap` | 语义目标与实际网页控件的本地映射；不进入模型请求 |
| `ExecutionPlan` | 根据有效答案生成的填写、选择、提交、翻页或重答动作 |
| `ActionResult` | 实际动作结果；结果未知时不能认定提交成功 |
| `PlatformState` | 选中状态、填写内容、反馈、重试入口、提交入口、完成状态和公开成绩 |

选项及填空 ID 在当前题目内唯一。单选最多选择一项；填空题使用填空字段。图片句柄绑定当前观察，页面变化或会话结束后需要重新取得内容。

## 会话

`QuizSession` 表示当前测验。`SessionRuntimeSnapshot` 保存会话状态、输入方式、Provider、模型、调用费用、进度、提示和临时总结。

快照中的 `checkpoint` 包含已求解答案、最近题目结果、`submission_pending` 和答案重试计数。这个检查点用于恢复操作，不能作为平台完成证据。提交状态未知时先核对公开结果。

运行方式为 `unattended`。输入方式有 `structured`、`semantic_snapshot` 和 `visual_snapshot`。`SessionSummary` 包含已答、猜答、重试、跳过、失败数量、调用次数、公开成绩及停止原因。

## Provider

`ProviderProfile` 保存接口类型、服务地址、模型目录、能力和每批限制。密钥通过 `secret_ref` 单独存入本地，界面列表不包含密钥值。图片输入授权和原生搜索设置适用于这个 Provider 的模型。

`ModelCallBudget` 维护独立任务的上限、已用额度和预留额度。请求开始前保存预留费用，能够确认实际费用时结算；费用不明确时保留已经预留的费用。

## 课程和资源

| 对象 | 当前含义 |
| --- | --- |
| `CourseCatalog` | 课程、班级、平台、页面类型、目录版本、完整性、任务列表、规则及加载依据 |
| `LearningTask` | 任务 ID、实际课时和章节 ID、标题、顺序、前置条件、状态及可取得的资源身份 |
| `CourseSurfaceSnapshot` | 本次实际 DOM 观察、元素 ID、公开属性、地址及经核验的父框架上下文 |
| `CourseSurfaceReading` | 模型引用本次元素 ID 识别的目录、资源、控件、结果和规则 |
| `VideoSnapshot` | 实际媒体身份、位置、时长、倍速、暂停、缓冲、回看、结束及弹题 |
| `QuizBoundary` | 测验或弹题身份、所属课程与资源、重试、剩余次数及及格规则 |
| `CourseVerification` | 对应任务的平台记录、提交、完成、及格、待批阅和公开成绩 |
| `CourseTaskIssue` | 具体任务、所属课时、问题原因及结束复核状态 |

`LearningTask.kind` 为 `lesson`、`video`、`lesson_quiz`、`chapter_quiz` 或 `excluded`。视频、测验和范围外资源必须属于实际课时；资源依赖不能循环，也不能引用未发现资源。

目录中的 `coverage` 记录实际加载数量、公开总数及加载是否结束。`resource_discovery` 记录每个课时的资源发现状态和失败原因。规则中的未知值保持 `null`，在相关操作前检查所需条件。

## 课程恢复

`CourseRuntime` 保存范围、当前资源、实际视频状态、估算时间、测验结果、范围外任务及待处理原因。检查点另外保存目录、已核验资源、子资源、未确认测验、子测验快照、重答次数及回看次数。

`SavedCourseRecord` 包含课程运行快照、原始启动配置、清理敏感参数后的课程地址和更新时间。准备会话保存相同课程加载所需的配置、预算及目录。恢复时使用实际页面重新核验这些身份和结果。
