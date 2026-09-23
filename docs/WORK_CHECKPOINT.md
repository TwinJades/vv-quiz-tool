# VV 工作断点与验收记录（2026-09-23）

## 2026-09-23 最新结果

- 弹窗“模型输入”滑条移除三段下方小字；圆点连续拖动，松开后以约 250 ms 动画吸附到最近的三种模式。专用浏览器已检查连续位置和吸附动画。
- 快照分离从独立原型接入扩展：仅在结构化观察与本地候选题干不一致时，让模型标注预分配的区域/选项 ID；本地再核验 DOM、顺序和指纹。通过的结构特征只在当前会话内复用；复用的下一题改用结构化输入。当前仅覆盖原生单选/多选候选，其他布局沿原路径运行。
- Gemini 3.8 实测：独立试验正确返回区域及选项 ID；扩展内的异常布局连续完成 2 题，1 次校准 + 2 次解题，0 暂停/猜答。此布局是专用浏览器标签中的试验 DOM，并非真实陌生站点。
- 接入后 W3Schools C 前 5 题再次连续完成，已验证翻至第 6 题；5 次调用，0 暂停、猜答、重试或失败。仍未完成整场 25 题和用户 Edge 最新构建验收。

## 2026-09-23 新对话接续

- 已核对复制的聊天记录、项目规格与当前代码。上轮最后的系统错误发生在小范围快照分离试验中；仓库并无 Git 初始化。
- 新增的 `SeparationTrial` 现可在本地解析器漏掉题干的测试布局中，用预分配区域/选项 ID 找回题干及选项；拒绝伪造 ID、结构变化和歧义匹配。经验证的结构特征可导出并在新实例中复用。该代码仍是**独立试验**，尚未接入 VV 自动流程，也未证明真实模型校准或真实 token 节省。
- W3Schools C 专用浏览器当前第 2 题的逐题 DOM 观察正常，得到正确题干、4 个选项及 `control_next`，`Next ❯` 不再被归为提交。
- 用户明确允许再用 Gemini 真实测试。CPA `gemini-3.8-flash-high` 与 `gemini-3.7-flash-high` 各调用一次，均返回“current account is not eligible ... not currently available in your location”；两次都在 SOLVE 暂停，0 题作答。用户正在核查 CPA 新账号，未取得新的 W3 前 5 题闭环结果。不要重复调用这两个模型，待用户确认可用 Provider。
- 完整 `pnpm check` 已通过：类型检查、12 个测试文件共 61 项测试、正式构建。`dist/manifest.json` 保持正式权限配置。

## 2026-09-23 恢复后更新

- 重新阅读本断点与相关源码。当前宿主的隐藏 Chrome for Testing 初次启动发生 GPU 进程致命退出；加入 no-sandbox、禁用 GPU 等参数后可启动 CDP，但本地 VV 扩展未注册（隔离 profile 的扩展设置为空），测试脚本在读取 chrome.storage.local 时中止。前台关闭后重试及沙箱外启动均未恢复扩展加载。因此**没有产生新的 W3Schools C 真实运行结果**，不得把前 5 题标记通过。
- 已运行一次 pnpm check：类型检查通过，11 个测试文件、59 项测试通过，正式构建通过。dist/manifest.json 已恢复为正式权限配置。
- 已新增 docs/real-site-acceptance.md，记录稳定入口、已通过的真实模型整场回归和未完成验收。
- 下一步先解决当前环境的隔离浏览器扩展加载，再用已有详细 ADVANCE 诊断复测 W3Schools C。只有取得诊断后才针对性修改；最后需前 5 题连续无暂停。快照辅助数据分离仍是只读评估，不混入此修复。

## 本次暂停时的准确状态（优先于下方历史记录）

- 已按用户要求停止真实网站测试；隔离 Chrome for Testing 已关闭。正式 `dist/manifest.json` 已由 `pnpm build` 恢复，不再带临时测试 `host_permissions`。
- 最后一次代码修改仅扩充了 ADVANCE 失败诊断；其后 `pnpm typecheck` 和 `pnpm build` 均通过。此前完整 `pnpm check` 为 11 个文件、59 项测试通过；之后新增的 DOM 跨页观察测试经定向运行 19/19 通过，但**最后几处代码改动后尚未重跑完整测试**。恢复后需一次最终 `pnpm check`。
- 当前源码可构建。没有正在运行的测验。临时隔离浏览器配置及脚本保留供恢复测试，不要误当正式产物。清理时必须移入操作系统回收站，禁止永久删除。

### 本轮真实模型验证

| 网站 | 结果 |
| --- | --- |
| Frontend Beauty `/test-me` | 隐藏隔离 Chrome for Testing + CPA `gemini-3.8-flash-high`，20/20 题作答，20 次调用，0 猜答/重试/失败；VV `COMPLETE`，网站显示 Interview complete、19/20、95%，最终提交已自动执行。该站本轮生成 20 题，非旧验收的 15 题。 |
| QuizzyDaily Food & Drink: Tasty Trivia | 从分类页站内进入后，15/15 题完成，15 次真实模型调用，0 猜答/重试/失败；VV `COMPLETE`，到达 `/completed` 结果页。直接新开深链接曾偶发跳回 `/quizzes`，属于隔离测试进入方式，已改用站内入口。 |
| W3Schools C | 原先第 1 题 ACT 前的假 PAGE_CHANGED 已由指纹计算对齐修复。真实测试多次能回答前 4 题并到达第 5 题，0 猜答；但 ADVANCE 的跨页结果有时误判 PAUSED，尚未满足“连续完成前 5 题无暂停”。**不得报告为通过**。最后一次诊断构建尚未用于真实复测，因用户要求暂停。 |

真实模型测试授权来自用户；无需再次询问 Provider 权限。隔离 Edge 153 不能通过当前命令行/CDP 加载未打包扩展，所以以上为后台 Chrome for Testing 的真实网页回归，用户 Edge 本身的最新版本验收仍未完成。测试必须继续保持隐藏，不占用户屏幕或鼠标。

### W3Schools C 尚待解决的精确问题

- 旧版指纹计算把答题区域里的其他文本输入也算进 `blanks`，而观察解析单选题时 `blanks=0`，导致同题被误判 PAGE_CHANGED；现已统一计算并补 DOM 测试。
- W3 C 每点 `Next ❯` 会跨页；旧页内容脚本失效后，新页没有当前观察。现在 `observation_missing` 可恢复，且新页确有不同指纹时控制动作返回 `unknown` 由 VV 验证，不盲点。
- 尚存的 PAUSED 形态：日志为 `stage=ADVANCE ... old_fingerprint=... new_fingerprint=... target_status=advance_unverified`，而网页已显示下一题。怀疑在旧页反馈、内容脚本切换和题目加载期间，`advanceBefore`/`advanceAfter` 采样时间窗与页面真实进度不一致。等待 ADVANCE 已加至最多约 30 秒，但仍复现。
- 最新源码已在 ADVANCE 暂停信息中增加 `answer_before`、`answer_after`、`old_observation`、`new_observation`、`action_status`，**尚未以真实站点运行到该新诊断**。恢复后先用此诊断复现一次，不要继续猜测式修改；然后做最小修复，再完成至少连续前 5 题。
- 临时测试脚本为 `scripts/edge-real-regression.mjs`，运行目标 `w3c`；浏览器配置在 `.browser-regression-runtime/profile`。测试前需临时给 `dist/manifest.json` 加三个站点和 `http://127.0.0.1:8317/*` 的 `host_permissions`，并以可访问网络的权限启动隐藏 Chrome for Testing。结束后 `pnpm build` 恢复正式 manifest。

### 快照辅助数据分离：只读评估结论，暂不实施

用户要求先给可行性与小试验范围，再决定是否编码。已给出的结论：**可行，但当前 `semantic_snapshot` 只辅助已成功解析的题目；结构化提取失败会在生成快照前抛错**。最小原型应新增独立安全候选快照入口，让模型仅返回已有临时题目区域/控件 ID 的角色；本地核验控件仍在 DOM、选项同组、文本/身份/指纹一致后，才形成题目结构与本场临时结构特征。下一题匹配时仅发送结构化题目，失配再校准。禁止脚本、CSS 选择器、坐标、长期题目/答案/快照存储。通用规则和网站规则只经人工审查发布；一次成功不得自动升级为通用规则。按 15–20 题稳定结构估算，模型输入可由每题约 3000 token 降至首次约 3000 + 后续每题约 450，约节省 79–81%；重校准会降低收益。测试必须证明原本无法提取的题目被正确分离，且下一题请求不含整页快照，而不只是答题上下文增多。**等待用户决定是否按此范围实施，不得在恢复 W3 测试时擅自全面重构。**

### 恢复顺序

1. 读本节与相关源码；不要重做已通过的 Frontend Beauty/QuizzyDaily 整场验收。
2. 用隐藏隔离 Chrome + 真实模型跑 W3Schools C 一次，读取新增详细 ADVANCE 诊断，修复并完成前 5 题。不得操作用户可见 Edge。
3. 完成后运行一次 `pnpm check`，写 `docs/real-site-acceptance.md`，使用稳定入口而非随机会话 URL。
4. 关闭隔离浏览器，`pnpm build` 恢复正式产物；如需清理临时脚本、浏览器配置，只能送入操作系统回收站。
5. 快照辅助分离原型需等待用户对试验范围的决定；不要把它混入当前网站兼容修复。

## 历史断点（下列状态已被上文更新覆盖）

## 当前目标

继续完成真实网站兼容修复，并用隐藏隔离 Edge + 真实 `gemini-3.8-flash-high` 回归：

1. Frontend Beauty：完成 15 题并自动点击页面级最终提交，验证成绩页。
2. QuizzyDaily Food：完成整场，不能 ACT 失败或进入 FAILED。
3. W3Schools C：至少连续完成前 5 题。

用户明确允许使用该真实模型；测试不能占用用户屏幕和鼠标。

## 已完成代码

- 删除网页人工点击/输入导致的自动暂停；人工引发的页面变化统一走 PAGE_CHANGED 恢复。
- QuizzyDaily/React 动态 DOM：选项目标记录 name、value、规范化文本摘要和题目指纹；节点替换后按语义重绑，禁止按 `opt_n` 位置盲绑。
- PAGE_CHANGED、TARGET_UNAVAILABLE、节点脱离和语义匹配失败最多 3 次自动回到 WAIT_READY；诊断包含阶段、旧/新指纹、预期/实际选择、目标状态及是否自动重观察。
- Frontend Beauty：支持题目容器外的页面级最终提交，以及 Submit test / Submit answers / Finish interview / Finish test；仅在无下一题且确认最后一题/全部已答时执行，并验证成绩或结果页。
- W3Schools C：Next 正则支持 `❯`、`>`；加强代码选项文本与题目根选择。
- 新增三档“模型输入”拖动条并持久化：
  - `structured`：仅数据分离层；
  - `semantic_snapshot`：清洗后的整页可见文本 + 临时控件语义 ID；
  - `visual_snapshot`：再加入当前可见页截图（要求 Provider 图片能力和本地授权）。
- 快照/截图可直接给模型解答。模型可返回现有语义 ID 的 next / submit / session_submit / retry 分类；仅高置信且属于当前快照的 ID 进入本次观察的临时操作缓存，执行前仍做 LocatorMap、题目指纹和节点身份校验。
- 快照最多 20,000 字符，排除 script/style/template/隐藏节点/密码字段；不持久化题目、答案或截图。
- 更新 `docs/browser-adapter.md`、`docs/model-interface.md`。

## 2026-09-23 首次快照补充验证

- 首次快照完成数据分离校准后，两道受控题只用 3 次 Gemini 3.8 调用；陌生按钮 “Go to next question” 在首次识别并成功翻页后，第二题由本地重新唯一定位，最终确认页面到达第三题。0 暂停、0 猜答。详见 `docs/real-site-acceptance.md`。
- 五道受控 C 题的解题输入对照：逐题快照 25,205 token，首次快照后结构化 5,852 token，均 5/5 正确；仅证明该受控样本的输入节省。
- 候选按钮目标现在使用当前题指纹校验；结构化观察仍保留仅供本地复用的候选，不发送页面快照给解题模型。
- 三个真实站点在首次快照方案下各连续完成前 5 题并到第 6 题；Frontend Beauty、W3Schools C 各 5 次模型调用，QuizzyDaily 1 次校准加 5 次解题，共 6 次。均无暂停、猜答、重试或失败。新会话无保存偏好时默认“首次快照”档位，已有明确选择保留。

## 以下为本轮早期检查点（历史记录）

## 验证状态

- 最新 `pnpm typecheck`：通过。
- 定向命令实际运行了全部 Vitest：11 个测试文件、59 项测试全部通过。
- 最新 `pnpm build`：通过；正式 `dist/manifest.json` 已恢复，不含真实测试临时 `host_permissions`。
- 新增 DOM 用例覆盖：语义快照清洗、临时控件 ID；此前已覆盖 React 节点替换/重排、W3 Next `❯`、C 代码文本、页面级提交和恢复流程。

## 尚未完成

- 三个网站在本轮修改后的真实模型回归尚未跑通；不是站点或 Provider 报错，而是 Edge 153 的测试加载方式发生变化。
- 尚应补一个核心回归用例，直接证明模型返回的 `observed_controls` 候选可驱动缺少启发式匹配时的受控 ADVANCE/最终提交。
- 完成真实回归后新增 `docs/real-site-acceptance.md`，使用稳定入口，不记录带随机 `v=` 的会话 URL。
- 全部完成后运行一次 `pnpm check`。

## 隐藏 Edge 阻塞与下一步

- Edge：`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`，版本 153。
- 隔离配置：`.edge-real-regression-profile`（保留，未删除）。
- 临时脚本：
  - `scripts/edge-real-regression.mjs`
  - `scripts/close-edge-real-regression.mjs`
- 端口 9341 已关闭，隐藏 Edge 已退出。
- Edge 153 已不接受 `--load-extension`；扩展 URL 会落到 `chrome-error://chromewebdata/`。
- 已确认 `/json/protocol` 存在实验性 `Extensions.loadUnpacked/getExtensions/setStorageItems`。
- 用浏览器 WebSocket 直接调用返回 `No associated browser context`；用 page WebSocket 调用返回 `Method not available`。
- 下一步应在浏览器 WebSocket 上实现带 `sessionId` 的扁平 CDP 会话：先 `Target.attachToTarget({targetId, flatten:true})` 绑定 about:blank 目标，再让 Cdp 支持在消息顶层携带 `sessionId`，通过该 session 调用 `Extensions.*`。启动参数保留 `--enable-unsafe-extension-debugging`。
- `Extensions.loadUnpacked` 成功后，用 `Extensions.setStorageItems` 写入隔离专用 CPA Profile：
  - Base URL `http://127.0.0.1:8317/v1`
  - 模型 `gemini-3.8-flash-high`
  - 无 API Key（本地 CPA 当前配置）
  - 图片能力/授权为 true。
- 测试脚本当前默认 `observation_input_mode: "semantic_snapshot"`。
- 扩展真实测试前，`pnpm build` 后需临时给 `dist/manifest.json` 添加三个站点和 `127.0.0.1:8317` 的 `host_permissions`；结束后再 `pnpm build` 恢复正式产物。

## 已知人工验收基线

- W3Schools HTML：两轮无暂停/猜答，100% 与 92%，闭环通过。
- Frontend Beauty：人工验收 15/15、13/15，旧版只缺最终自动提交。
- QuizzyDaily Food/Minecraft：旧版在动态 DOM 后 ACT/FAILED。
- W3Schools C：旧版 SOLVE 后不能继续。
- 更早的真实模型隔离测试曾完成 QuizzyDaily Apple iPad 10/10；本轮仍需按上述三个目标重新验收。

## 清理规则

真实测试完成后：

1. 用关闭脚本退出仅属于隔离配置的 Edge。
2. 运行 `pnpm build` 恢复正式 manifest。
3. 临时脚本和 `.edge-real-regression-profile` 必须移入操作系统回收站，禁止永久删除。
