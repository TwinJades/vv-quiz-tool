# VV 自动答题工具

VV 是一个本地优先的 Chrome/Edge 浏览器扩展，按“观察测验 → 结构化求解 → 受控执行 → 结果验证”完成逐题网页测验。

当前源码实现 `PROJECT_SPEC.md` 中 `1.0.0` 的代码范围；正式标记和发布 `1.0.0` 前，仍需完成 Chrome、Edge 与真实逐题网站验收。因此扩展清单暂用预发布版本 `0.1.0`。

## 当前能力

- 逐题 DOM 页面中的单选、多选和单空/多空填空。
- 原生表单控件、ARIA 单选/多选控件、下拉单选、open Shadow DOM，以及已授权 iframe。
- 题目文字、MathML/TeX 文本和按需题目图片。
- 监督自动、无人值守两种全自动策略；运行中可切换，下一动作生效。
- Vercel AI SDK + OpenAI Compatible Provider；本地多 Profile、模型列表读取和手动回退。
- 答案结构与语义白名单校验、页面新鲜度检查、执行后 VERIFY。
- 答错后最多重解 2 次；Provider 临时故障最多调用 3 次；每场默认最多 300 次模型调用。
- 倒计时剩余 60 秒进入收尾状态。
- 验证码、登录失效、权限不足、监考提示、Provider 持续不可用时暂停。
- 临时会话总结；题目、答案、图片和运行记录不做永久保存。

整页多题、多标签统一任务面板、Canvas 坐标动作和 Provider 原生搜索不属于 `1.0.0`。

## 构建

要求 Node.js 20.11+ 与 pnpm 11。

```powershell
pnpm install
pnpm check
```

构建产物位于 `dist/`。构建脚本只覆盖当前产物，不自动删除目录中的其他文件。

## 安装到 Chrome 或 Edge

1. Chrome 打开 `chrome://extensions`；Edge 打开 `edge://extensions`。
2. 开启“开发者模式”。
3. 选择“加载已解压的扩展”，指向本项目的 `dist` 目录。
4. 打开扩展设置，添加 OpenAI Compatible Provider、API Key 与模型。
5. 打开逐题测验页面，在扩展弹窗中选择 Provider、模型和运行策略后启动。

网站和 Provider 权限均在用户操作时按来源请求，不在安装时取得所有网站权限。首次允许图片上传前，设置页会明确说明必要题目图片会发送给所选 Provider。

## 安全与数据

- API Key 与 Provider 配置保存在 `chrome.storage.local`，密钥与 Profile 分开存储。
- LocatorMap、DOM 节点引用、页面权限和密钥不会进入模型请求。
- 页面、题目图片、反馈和模型输出全部视为不可信输入。
- 模型只能返回题目中已有的语义 ID，不能返回或执行脚本、选择器及自由浏览动作。
- VV 没有项目服务器、遥测、题库、答案历史或训练流程。

外部 Provider 的数据处理政策由该 Provider 决定。

## 验证

本地测试覆盖核心协议、批次关联、状态机、调用预算、重试策略、Provider 存储、图片授权、DOM 解析、页面变化、执行计划与 VERIFY。真实网站和浏览器安装验收结果会在正式发布前单独记录。
