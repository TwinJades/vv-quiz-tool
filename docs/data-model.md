# 数据模型与协议

## 1. 约定

- 示例使用 JSON 表达；正式实现维护机器可校验 schema。
- 时间使用 ISO 8601 UTC，时长使用毫秒。
- `session_id` 标识一场测验，`run_id` 标识一次运行实例，`observation_id` 标识一次平台观察，`question_id` 标识单题。
- 平台原生节点、DOM Element、UIA Element、Accessibility Node、CSS selector 和 XPath 不得进入 QuestionFrame。
- 跨模块对象包含 `schema_version`；破坏性协议变更才提升主版本。

## 2. QuizSession

QuizSession 管理整场测验，不保存跨会话历史。

```json
{
  "schema_version": "1.0",
  "session_id": "session_01",
  "run_id": "run_01",
  "platform": "web",
  "layout": "multi_question_page",
  "strategy": "unattended",
  "status": "solving",
  "question_ids": ["q_1", "q_2", "q_3"],
  "progress": {
    "total": 3,
    "answered": 1,
    "guessed": 0,
    "skipped": 0,
    "failed": 0
  },
  "provider_profile_id": "provider_1",
  "model_id": "configured-model",
  "model_calls": {"used": 2, "limit": 300},
  "timer": {"remaining_seconds": null, "closing_window_seconds": 60},
  "created_at": "2026-09-21T12:00:00Z"
}
```

`layout`：`sequential`、`multi_question_page`。运行策略：`supervised`、`unattended`。

## 3. SessionObservation

PlatformAdapter 的一次测验级观察：

```json
{
  "schema_version": "1.0",
  "session_id": "session_01",
  "observation_id": "obs_01",
  "captured_at": "2026-09-21T12:00:01Z",
  "platform": "web",
  "surface": {
    "target_id": "tab_23",
    "origin": "https://example.test",
    "title": "练习"
  },
  "layout": "multi_question_page",
  "question_candidates": [],
  "session_controls": [],
  "timer": null,
  "stability": {"fingerprint": "session-fingerprint", "stable_for_ms": 600}
}
```

原始本地引用只存在于短生命周期 Observation 和 LocatorMap，不进入模型或日志正文。

## 4. QuestionFrame

QuestionFrame 是单题的最小语义对象：

```json
{
  "schema_version": "1.0",
  "session_id": "session_01",
  "question_id": "q_1",
  "observation_id": "obs_01",
  "type": "single_choice",
  "stem": {
    "text": "2 + 2 = ?",
    "format": "plain_text",
    "media": []
  },
  "options": [
    {"id": "opt_1", "text": "3", "media": []},
    {"id": "opt_2", "text": "4", "media": []}
  ],
  "blanks": [],
  "constraints": {"min_selections": 1, "max_selections": 1},
  "provenance": {"text_source": "dom", "untrusted_content": true}
}
```

支持类型：`single_choice`、`multiple_choice`、`fill_blank`。其他类型可保留协议枚举，但能力协商必须阻止未实现执行。

## 5. MediaRef 与 VisualFrame

题目图片使用临时引用：

```json
{
  "id": "media_1",
  "kind": "image",
  "purpose": "question_diagram",
  "source": "dom_image",
  "mime_type": "image/png",
  "width": 640,
  "height": 480,
  "temporary_handle": "temp_media_1"
}
```

Canvas 或视觉坐标操作使用 VisualFrame：

```json
{
  "visual_frame_id": "vf_1",
  "observation_id": "obs_01",
  "surface_id": "tab_23",
  "viewport": {"width": 1280, "height": 720, "scale": 1},
  "region": {"x": 0, "y": 100, "width": 900, "height": 600},
  "fingerprint": "visual-fingerprint",
  "captured_at": "2026-09-21T12:00:02Z",
  "temporary_handle": "temp_visual_1"
}
```

临时图片与截图在会话结束或取消后释放，不进入题库或历史。

## 6. LocatorMap

LocatorMap 按题目维护语义 ID 到本地目标的映射：

```json
{
  "schema_version": "1.0",
  "session_id": "session_01",
  "question_id": "q_1",
  "observation_id": "obs_01",
  "platform": "web",
  "question_fingerprint": "q-fingerprint",
  "targets": {
    "opt_1": {"kind": "semantic", "local_ref": "node_12", "role": "radio"},
    "opt_2": {"kind": "semantic", "local_ref": "node_13", "role": "radio"}
  }
}
```

视觉目标不伪装成语义目标：

```json
{
  "kind": "coordinate",
  "visual_frame_id": "vf_1",
  "point": {"x": 510, "y": 430},
  "expected_label": "B",
  "confidence": 0.93
}
```

执行前必须重新验证语义目标或 VisualFrame 新鲜度。

## 7. QuestionBatch

```json
{
  "schema_version": "1.0",
  "session_id": "session_01",
  "batch_id": "batch_01",
  "question_ids": ["q_1", "q_2"],
  "questions": [],
  "capability_requirements": {"image_input": true, "native_web_search": false},
  "attempt": 1
}
```

约束：

- 每个 question_id 在批次中唯一。
- 批次响应必须逐题返回，不允许依靠数组位置猜测对应关系。
- 单题失败可从批次中拆出重新求解。

## 8. BatchAnswerResult 与 AnswerResult

```json
{
  "schema_version": "1.0",
  "session_id": "session_01",
  "batch_id": "batch_01",
  "answers": [
    {
      "question_id": "q_1",
      "answer_type": "single_choice",
      "status": "answered",
      "selected_option_ids": ["opt_2"],
      "blank_answers": [],
      "confidence": 0.98,
      "warnings": []
    }
  ],
  "errors": [
    {"question_id": "q_2", "code": "CANNOT_ANSWER", "retryable": true}
  ]
}
```

AnswerResult 只引用 QuestionFrame 中存在的语义 ID。状态：`answered`、`uncertain`、`cannot_answer`。

## 9. RetryContext

```json
{
  "question_id": "q_1",
  "attempt": 2,
  "max_retries_after_initial": 2,
  "previous_answers": [["opt_2"]],
  "site_feedback": "回答错误",
  "remaining_option_ids": ["opt_1", "opt_3"],
  "can_resubmit": true
}
```

站点反馈属于不可信数据，只用于当前题目的重新求解。不可保存为题库或自动学习数据。

## 10. ProviderProfile

```json
{
  "schema_version": "1.0",
  "provider_profile_id": "provider_1",
  "display_name": "个人 CPA",
  "provider_type": "openai_compatible",
  "base_url": "https://provider.example/v1",
  "secret_ref": "local-secret-1",
  "model_catalog": {
    "source": "provider_api",
    "models": ["model-a", "model-b"],
    "refreshed_at": "2026-09-21T12:00:00Z"
  },
  "capabilities": {
    "image_input": true,
    "structured_output": true,
    "native_web_search": false
  }
}
```

用户可以新增、编辑和删除多个 ProviderProfile。活动会话使用中的 Profile 不得在没有确认迁移或停止的情况下删除。

## 11. ExecutionPlan 与 ActionResult

```json
{
  "session_id": "session_01",
  "question_id": "q_1",
  "observation_id": "obs_01",
  "strategy": "unattended",
  "actions": [
    {"action_id": "act_1", "kind": "set_selected", "target_id": "opt_2", "value": true}
  ],
  "preconditions": ["same_question_fingerprint", "target_available"]
}
```

ActionResult 状态：`succeeded`、`failed`、`skipped`、`unknown`。`unknown` 必须先进入 VERIFY，不能直接重复提交。

## 12. VerificationResult

```json
{
  "session_id": "session_01",
  "question_id": "q_1",
  "status": "verified",
  "stage": "graded",
  "outcome": "incorrect",
  "signals": [],
  "can_retry": true,
  "next_action": "resolve_again"
}
```

`stage`：`answer_applied`、`submitted`、`graded`、`advanced`、`session_submitted`、`session_completed`。

## 13. SessionSummary

```json
{
  "session_id": "session_01",
  "status": "completed",
  "total": 20,
  "answered": 19,
  "guessed": 2,
  "retried": 3,
  "skipped": 1,
  "failed": 0,
  "coordinate_actions": 4,
  "model_calls": 28,
  "visible_score": "18/20",
  "stop_reason": null
}
```

SessionSummary 只存在于当前会话 UI；关闭后清除。

## 14. 错误模型

建议分类：`readiness`、`observation`、`parse`、`provider`、`answer_validation`、`page_changed`、`visual_stale`、`execution`、`verification`、`permission`、`authentication`、`hard_blocker`、`cancelled`、`internal`。

错误必须标明是否可重试、从哪个阶段恢复，以及是否需要用户处理。

## 15. 版本与兼容性

- `schema_version` 与产品版本分别管理。
- 新增平台 Adapter 不改变核心 schema 主版本。
- 新增可选字段提升协议次版本；删除、改义或改变必填规则才提升协议主版本。
- 未知主版本必须拒绝处理，不能静默猜测。

