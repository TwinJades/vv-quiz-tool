# 主线独立浏览器验收

## 连接来源

主线验收不再必须依赖某个已经打开的配置浏览器。现有 EasyCPA 服务由 `D:\EasyCLIProxyAPI-v0.3.4-Windows-amd64\cpa-core\cli-proxy-api.exe` 提供，配置文件为同目录 `config.yaml`。

- 只读 `server.port` / TLS 设置和 `access.api-keys`，确认端口 8317、非 TLS、唯一已有本地客户端密钥。
- 顶层 `api-keys` 存放上游凭据，不能当作本地客户端密钥；不使用它连接上游。
- 只把客户端密钥传入自己隔离测试扩展所需的临时本地存储；不修改 EasyCPA 配置，不输出到命令窗口、日志、文档或报告。
- 文件结构不支持、客户端密钥不唯一、入口不可用或授权失败时停止本场，不猜密钥、不切换服务。
- 真实调用入口固定 `http://127.0.0.1:8317/v1`。既有三种授权实际 ID 与本场重新取得的 `/models` 列表取交集，优先 3.8。低优先级覆盖仍需要保留的高优先级不可用证据。
- 不读取课程浏览器、用户浏览器或人工记录器。本聊天不处理网课视频。

## 主线使用方式

以下设置仅作用于该命令所在的 PowerShell 进程，不改变用户保存的配置。模型 ID 来自此前已配置并验收过的三种授权 ID；每场仍重新核对服务列表。

```powershell
$env:VV_EASYCPA_CONFIG_PATH='D:\EasyCLIProxyAPI-v0.3.4-Windows-amd64\cpa-core\config.yaml'
$env:VV_EASYCPA_MODELS='gemini-3.8-flash-high,gemini-3.7-flash-high,gemini-3.1-pro-low'
$env:VV_TEST_STRATEGY='unattended'
$env:VV_TEST_SITES='h5p-image-multi,h5p-blanks'
node scripts/background-regression.mjs
```

可用 `VV_TEST_BROWSER` 指定独立测试 Edge 程序；`VV_TEST_STRATEGY=supervised` 复验监督模式。每场必须至少两个自有网站并行，建立全新 profile 与独立扩展构建。浏览器隐藏运行，因此桌面不会出现窗口。报告与 PNG 在打印出的 `REPORT_DIRECTORY` 中；程序正常或失败结束后关闭自己的浏览器。

未指定 `VV_EASYCPA_CONFIG_PATH` 时保留原有已配置 VV 浏览器读取方式，但这次主线不使用旧 CDP50739，也不连接另一个对话的浏览器。

## 保留和回收

保留报告、日志、截图和失败原始证据。结束后通过项目清理工具预览，再把 `profile` 和 `extension` 等可重建目录移入回收站。调用时使用已安装 PowerShell 7 (`pwsh`)，Windows PowerShell 5.1 的字典属性求和不兼容；本次 5.1 预览在求和阶段报错，没有执行回收。

新网站筛选结果见 `PUBLIC_QUIZ_CANDIDATES_20261005.md`。这些分类和本机测试不能替代一个真实图文三型活动的完整验收，也不代表 1.2.0 完成。
