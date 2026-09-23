# 真实网站验收记录（2026-09-23）

| 网站与稳定入口 | 环境 | 结果 | 状态 |
| --- | --- | --- | --- |
| [W3Schools HTML Quiz](https://www.w3schools.com/quiztest/quiztest.asp?qtest=HTML) | 用户 Edge、真实模型 | 两轮无暂停、无猜答，分别为 100% 和 92%。 | 通过 |
| [Frontend Beauty](https://www.frontend.beauty/test-me) | 隐藏隔离 Chrome for Testing、CPA gemini-3.8-flash-high | 20/20 题作答，20 次调用，0 猜答、重试或失败；自动提交，结果页显示 19/20（95%），VV 为 COMPLETE。 | 通过；用户 Edge 最新构建待验 |
| [QuizzyDaily Food & Drink: Tasty Trivia](https://www.quizzydaily.com/quiz/food-drink/food-and-drink-tasty-trivia) | 隐藏隔离 Chrome for Testing、CPA gemini-3.8-flash-high | 从分类页站内进入，15/15 题完成，15 次调用，0 猜答、重试或失败；到达结果页，VV 为 COMPLETE。 | 通过；用户 Edge 最新构建待验 |
| [W3Schools C Quiz](https://www.w3schools.com/quiztest/quiztest.php?qtest=C) | 隐藏专用浏览器、CPA `gemini-3.8-flash-high` | 新代码连续完成前 5 题并验证翻到第 6 题；5 次模型调用，0 暂停、猜答、重试或失败。先前账号地区不可用的 Provider 故障已由用户更新账号解决。 | 前 5 题回归通过；整场 25 题尚未验收 |

另在同一隐藏浏览器中，将会漏读题干的试验布局临时放入已授权标签：Gemini 3.8 校准一次后连续完成两题，共 3 次调用（1 次校准、2 次解题），第二题复用结构化输入。该结果验证校准路径，尚不代表真实陌生网站已通过。隔离浏览器的通过结果不能替代用户 Edge 最新构建的验收。正式扩展不包含测试专用站点或 Provider 权限。

首次快照对照：在 W3Schools C 页面壳上替换 5 道受控 C 题，逐题快照为 25,205 输入 token、5/5 正确；首次快照后改用结构化题目为 5,852 输入 token、5/5 正确，输入 token 少 76.8%。这组数据只比较解题输入，不能单独证明数据分离或按钮识别效果。另在无测验脚本干扰的同源静态页注入三题试验布局：首次由 Gemini 3.8 校准题目区域并识别本地规则不认识的 “Go to next question” 按钮；前两题作答并翻到第三题，共 3 次调用（1 次校准、2 次解题）、0 暂停或猜答。第二题未再次发送页面快照，按钮由本地按首次成功翻页的文字重新唯一定位。上述布局仍是受控试验，尚未证明在不同真实网站上同样有效。

## 首次快照方案的真实站点短程回归

隐藏专用浏览器、CPA `gemini-3.8-flash-high`；`semantic_snapshot` 档位改为首次快照、后续结构化数据后：

| 网站 | 结果 | 模型调用 | 状态 |
| --- | --- | ---: | --- |
| Frontend Beauty | 连续完成 5 题，页面到第 6/20 题 | 5 | 0 暂停、猜答、重试、失败 |
| QuizzyDaily Food & Drink | 首次题目区域校准 1 次，完成 5 题，页面到第 6/15 题 | 6 | 0 暂停、猜答、重试、失败 |
| W3Schools C | 连续完成 5 题，页面到第 6/25 题 | 5 | 0 暂停、猜答、重试、失败 |

QuizzyDaily 会把整场题目留在 DOM 中，仅显示当前题，且每题的单选组名称不同。复测据此改为只复用唯一可见、控件类型和选项数相同的题目区域；旧题仍留在 DOM 时不再误认。上述结果是每站前 5 题的短程回归，尚未验证整场结束和所有布局变化。

## 题型测试网址汇总

以下入口与上表已测的 Frontend Beauty、QuizzyDaily、W3Schools HTML/C 测验放在同一记录中。页面能打开只表示可作为测试目标；尚未完成 VV + 模型的端到端验收时不记为通过。

| 题型 | 测试入口 | 页面核对 | VV 验收状态 |
| --- | --- | --- | --- |
| 多选及图片选项 | [H5P Image Choice](https://h5p.org/h5p/embed/1249570) | 已在隐藏浏览器看到 7 个图片选项，控件为 ARIA checkbox；修复了这类控件内的图片提取。 | 隐藏浏览器 + Gemini 3.8 实测：7 个图片选项中选中 4 个正确答案，网站 4/4，VV COMPLETE；1 次模型调用，0 猜答/重试/失败。 |
| 多选 | [H5P APA Style Review](https://h5p.org/h5p/embed/1208207) | 已打开；多选题在课件后续页面，题干为“Why do we cite our sources? Select all that apply.” | 尚未完成交互和模型验收。 |
| 多选 | [H5P ConfirmationDialog 示例](https://h5p.org/h5p/embed/1463425) | 已打开；两个 ARIA checkbox 和 Check 按钮，属于课件内控件。 | 尚未完成交互和模型验收。 |
| 多空填空及题目图片 | [H5P Fill in the Blanks](https://h5p.org/node/611) | 已打开；首个示例在同源 iframe 中显示 3 个文本空格和图片。 | 尚未完成模型验收；此页直接 embed/837 返回 Content unavailable。 |
| 多空填空 | [H5P Passive Voice Past Negative](https://h5p.org/h5p/embed/1039075) | 独立活动，5 个文本空格和 Check 按钮。 | 隐藏浏览器 + Gemini 3.8 实测：填写 5 空并提交，网站最终 5/5，VV COMPLETE；1 次模型调用，0 猜答/重试/失败。 |
| 整页填空参考 | [EngQuiz Present Simple B1](https://www.engquiz.pro/grammar/exercises/tenses/gap-fill-present-simple-b1) | 已打开；同页 20 道填空。 | 属于 1.1.0 整页多题范围，不作为 1.0.0 逐题验收。 |
| 主观题安全暂停 | [UBC H5P Essay 示例](https://h5p.open.ubc.ca/h5p-examples/essay/) | 页面说明主观题，但隐藏浏览器中嵌入内容未加载。 | 1.0.0 不自动作答；本地长文本框定向测试已验证作答前暂停，真实站点尚未验收。 |

## 逐步耗时试验

隐藏专用浏览器、W3Schools C 前 3 题、CPA `gemini-3.8-flash-high`，全部作答并到达第 4 题；总耗时 46,531 ms。阶段时间包含相应步骤和少量调度开销，百分比以记录到的阶段总时长为分母。

| 阶段 | 累计耗时 | 占比 | 主要步骤 |
| --- | ---: | ---: | --- |
| 模型求解 SOLVE | 32,894 ms | 71% | `solve_model` 32,892 ms，平均 10,964 ms/题 |
| 翻页 ADVANCE | 6,643 ms | 14% | `wait_advance_outcome` 6,539 ms |
| 等待页面 WAIT_READY | 2,486 ms | 5% | `wait_ready` 2,482 ms |
| 答案校验阶段 | 1,898 ms | 4% | 执行前重读页面 `read_before_action` 1,893 ms；纯答案校验 2 ms |
| 作答 ACT | 1,799 ms | 4% | `wait_answer_application` 1,655 ms；点击/填写 141 ms |
| 其余阶段 | 约 321 ms | 约 1% | 观察、分批和验证 |

当前优先优化方向是模型调用时长，其次是翻页后的页面稳定等待。此结果只是 W3Schools C 的小样本，不代表所有网站。
