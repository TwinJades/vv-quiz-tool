# 公开混合逐题活动候选审查（2026-10-03）

这是只读网站结构审查，不是 VV 答题通过报告。独立隐藏浏览器沿公开目录实际链接读取类型计数；未调用模型或输入答案，登录阻断页面不分类、不继续访问。未保存或发送隐藏正确答案。

## 使用入口

人工测试推荐网站列在 `scripts/browser-acceptance-state.mjs`、记录页和 [人工验收说明](manual-acceptance.md)。记录器监听其独立浏览器中自行打开的网页；本表是寻找严格混合单场的候选清单，不能视为全部推荐。

严格条件：同一个可访问逐题活动包含文字、题目图片、单选、多选和填空，全部题型受支持，并完成整场。介绍页图片不等于题目图片；不同活动不能拼成同一场。

## 审查证据

### 17:37 新目录与LibreStudio直接活动

MSU目录 [ISB202](https://openbooks.lib.msu.edu/isb202/h5p-listing/)在自己的隐藏浏览器实际返回CloudFront `403 ERROR / The request could not be satisfied`，`site-audit-2026-10-03T09-06-45.036Z`保留原页面与截图；停止访问，没有绕过防护。旧工具的access_blocked=false是识别遗漏，现已增加此阻断判断，不能据旧布尔值宣称可用。

[LibreStudio目录](https://studio.libretexts.org/library)的实际原生Question Set单选项和GET搜索于`site-audit-2026-10-03T09-11-19.844Z`执行；返回网址虽含`type=Question+Set`且单选项勾选，但列表仍是全部26658活动，分页链接还丢弃type，首屏包含其他题型。此前`09-06-45.036Z`沿20个实际链接读取，不能认定是QuestionSet筛选结果。没有猜测资源ID或把选项状态当筛选成功。

改用原站公开可搜索的直接活动链接。`site-audit-2026-10-03T09-17-41.784Z`退出0、零模型，仅记录题型数量和题图布尔值，未保留隐藏正确答案；六个活动均不满足严格混合条件：

| 直接活动 | 单选 | 多选 | 填空 | 未支持 | 题图 | 结论 |
|---|---:|---:|---:|---:|---|---|
| [25456 Chapter Nine Self-Test 9.6A](https://studio.libretexts.org/h5p/25456) | 8 | 0 | 2 | 0 | 无 | 缺多选和题图 |
| [28069 Module 14 Quiz](https://studio.libretexts.org/h5p/28069) | 10 | 0 | 0 | 0 | 无 | 只有单选，介绍图片不计题图 |
| [25616 Phylogenetic Tree](https://studio.libretexts.org/h5p/25616) | 6 | 0 | 0 | 0 | 无 | 只有单选，介绍图片不计题图 |
| [2375 Calculus demo](https://studio.libretexts.org/h5p/2375) | 2 | 0 | 1 | 0 | 无 | 缺多选和题图 |
| [1917 Pharmacokinetics Quiz](https://studio.libretexts.org/h5p/1917) | 6 | 0 | 4 | 0 | 无 | 缺多选和题图，介绍图片不计题图 |
| [16900 ENERGY](https://studio.libretexts.org/h5p/16900) | 2 | 1 | 0 | 0 | 无 | 缺填空和题图 |

`site-audit-2026-10-03T09-35-57.322Z`新增八个直接公开活动，全部完成只读审查、退出0、零模型，仍没有严格合格单场：

| 直接活动 | 单选 | 多选 | 填空 | 未支持 | 题图 | 结论 |
|---|---:|---:|---:|---:|---|---|
| [4302 Skeletal Muscle 10.2A](https://studio.libretexts.org/h5p/4302) | 0 | 0 | 0 | 2 | 无 | 两道Essay未支持 |
| [4313 Nervous System Control of Muscle Tension](https://studio.libretexts.org/h5p/4313) | 1 | 0 | 0 | 0 | 无 | 只有单选 |
| [6356 Cardiac Muscle and Electrical Activity](https://studio.libretexts.org/h5p/6356) | 5 | 0 | 0 | 0 | 无 | 只有单选 |
| [29463 Muscle Tissue Review](https://studio.libretexts.org/h5p/29463) | 11 | 0 | 0 | 0 | 无 | 只有单选 |
| [10881 Periodic trends on lattice energy](https://studio.libretexts.org/h5p/10881) | 4 | 0 | 0 | 0 | 有 | 缺多选和填空 |
| [660 Energy](https://studio.libretexts.org/h5p/660) | 2 | 0 | 2 | 0 | 无 | 缺多选和题图 |
| [3810 Vitamins and Minerals Involved in Energy Metabolism](https://studio.libretexts.org/h5p/3810) | 6 | 2 | 0 | 0 | 无 | 缺填空和题图 |
| [16899 BODY](https://studio.libretexts.org/h5p/16899) | 3 | 1 | 0 | 0 | 无 | 缺填空和题图 |

主报告 `site-audit-2026-10-03T05-30-14.463Z/report.json` 沿 15 个实际目录页审查 272 个活动：260 个可分类、12 个访问阻断，未找到严格合格活动。19684 有全部三种题型和题图，但还含一个未支持拖词题，不能跳过后记整场通过。

下表合并此前两轮候选，共 272 个唯一网址；分类来自活动元数据，尚需实际 VV 闭环验证。源报告均保留在 `.browser-regression-runtime/`，截图路径列于每份报告。

| 网站 | 单选 | 多选 | 填空 | 未支持 | 题目图片 | 审查结论 | 报告目录 |
|---|---:|---:|---:|---:|---|---|---|
| [211](https://h5pstudio.ecampusontario.ca/content/211) | 2 | 0 | 0 | 3 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [542](https://h5pstudio.ecampusontario.ca/content/542) | 2 | 0 | 0 | 2 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [677](https://h5pstudio.ecampusontario.ca/content/677) | 3 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [688](https://h5pstudio.ecampusontario.ca/content/688) | 4 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [876](https://h5pstudio.ecampusontario.ca/content/876) | 7 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [904](https://h5pstudio.ecampusontario.ca/content/904) | 2 | 0 | 2 | 1 | 无 | 缺多选；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [910](https://h5pstudio.ecampusontario.ca/content/910) | 15 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [947](https://h5pstudio.ecampusontario.ca/content/947) | 4 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [951](https://h5pstudio.ecampusontario.ca/content/951) | 1 | 0 | 0 | 2 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [1051](https://h5pstudio.ecampusontario.ca/content/1051) | 5 | 0 | 1 | 1 | 无 | 缺多选；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [1351](https://h5pstudio.ecampusontario.ca/content/1351) | 1 | 0 | 0 | 3 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [1410](https://h5pstudio.ecampusontario.ca/content/1410) | 2 | 1 | 0 | 0 | 有 | 缺填空 | site-audit-2026-10-03T05-30-14.463Z |
| [1444](https://h5pstudio.ecampusontario.ca/content/1444) | 1 | 0 | 0 | 1 | 有 | 缺多选；缺填空；含未支持题型 | site-audit-2026-10-03T05-30-14.463Z |
| [2091](https://h5pstudio.ecampusontario.ca/content/2091) | 4 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [2135](https://h5pstudio.ecampusontario.ca/content/2135) | 3 | 1 | 0 | 2 | 无 | 缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [2636](https://h5pstudio.ecampusontario.ca/content/2636) | 9 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [3061](https://h5pstudio.ecampusontario.ca/content/3061) | 8 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [3130](https://h5pstudio.ecampusontario.ca/content/3130) | 0 | 0 | 0 | 2 | 无 | 缺单选；缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [3188](https://h5pstudio.ecampusontario.ca/content/3188) | 20 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [3248](https://h5pstudio.ecampusontario.ca/content/3248) | 3 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [3257](https://h5pstudio.ecampusontario.ca/content/3257) | 10 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [3265](https://h5pstudio.ecampusontario.ca/content/3265) | 15 | 1 | 0 | 0 | 无 | 缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [3286](https://h5pstudio.ecampusontario.ca/content/3286) | 4 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [3308](https://h5pstudio.ecampusontario.ca/content/3308) | 3 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [3410](https://h5pstudio.ecampusontario.ca/content/3410) | 5 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [3533](https://h5pstudio.ecampusontario.ca/content/3533) | 9 | 0 | 0 | 0 | 有 | 缺多选；缺填空 | site-audit-2026-10-03T05-30-14.463Z |
| [3696](https://h5pstudio.ecampusontario.ca/content/3696) | 0 | 1 | 0 | 0 | 无 | 缺单选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [3810](https://h5pstudio.ecampusontario.ca/content/3810) | 3 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [3957](https://h5pstudio.ecampusontario.ca/content/3957) | 7 | 0 | 0 | 0 | 有 | 缺多选；缺填空 | site-audit-2026-10-03T05-30-14.463Z |
| [4021](https://h5pstudio.ecampusontario.ca/content/4021) | 12 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [4028](https://h5pstudio.ecampusontario.ca/content/4028) | 9 | 0 | 0 | 0 | 有 | 缺多选；缺填空 | site-audit-2026-10-03T05-30-14.463Z |
| [4166](https://h5pstudio.ecampusontario.ca/content/4166) | 3 | 0 | 3 | 0 | 无 | 缺多选；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [4293](https://h5pstudio.ecampusontario.ca/content/4293) | 11 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [4298](https://h5pstudio.ecampusontario.ca/content/4298) | 11 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [4301](https://h5pstudio.ecampusontario.ca/content/4301) | 7 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [4302](https://h5pstudio.ecampusontario.ca/content/4302) | 8 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [4711](https://h5pstudio.ecampusontario.ca/content/4711) | 3 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [4736](https://h5pstudio.ecampusontario.ca/content/4736) | 5 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [4754](https://h5pstudio.ecampusontario.ca/content/4754) | 3 | 0 | 0 | 0 | 有 | 缺多选；缺填空 | site-audit-2026-10-03T05-30-14.463Z |
| [5134](https://h5pstudio.ecampusontario.ca/content/5134) | 4 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [5200](https://h5pstudio.ecampusontario.ca/content/5200) | 4 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [5374](https://h5pstudio.ecampusontario.ca/content/5374) | 0 | 0 | 10 | 0 | 无 | 缺单选；缺多选；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [5387](https://h5pstudio.ecampusontario.ca/content/5387) | 8 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [5433](https://h5pstudio.ecampusontario.ca/content/5433) | 6 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [5733](https://h5pstudio.ecampusontario.ca/content/5733) | 2 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [6039](https://h5pstudio.ecampusontario.ca/content/6039) | 10 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [6200](https://h5pstudio.ecampusontario.ca/content/6200) | 8 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [6221](https://h5pstudio.ecampusontario.ca/content/6221) | 4 | 0 | 1 | 0 | 无 | 缺多选；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [6292](https://h5pstudio.ecampusontario.ca/content/6292) | 4 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [6346](https://h5pstudio.ecampusontario.ca/content/6346) | 0 | 0 | 0 | 1 | 有 | 缺单选；缺多选；缺填空；含未支持题型 | site-audit-2026-10-03T05-30-14.463Z |
| [6372](https://h5pstudio.ecampusontario.ca/content/6372) | 8 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [6699](https://h5pstudio.ecampusontario.ca/content/6699) | 11 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [6712](https://h5pstudio.ecampusontario.ca/content/6712) | 3 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [6890](https://h5pstudio.ecampusontario.ca/content/6890) | 11 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [8643](https://h5pstudio.ecampusontario.ca/content/8643) | 5 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [8985](https://h5pstudio.ecampusontario.ca/content/8985) | 9 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [9188](https://h5pstudio.ecampusontario.ca/content/9188) | 8 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [9242](https://h5pstudio.ecampusontario.ca/content/9242) | 5 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [9247](https://h5pstudio.ecampusontario.ca/content/9247) | 5 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [9414](https://h5pstudio.ecampusontario.ca/content/9414) | 10 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [9577](https://h5pstudio.ecampusontario.ca/content/9577) | 10 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [9582](https://h5pstudio.ecampusontario.ca/content/9582) | 10 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [9788](https://h5pstudio.ecampusontario.ca/content/9788) | 5 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [9828](https://h5pstudio.ecampusontario.ca/content/9828) | 2 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [10103](https://h5pstudio.ecampusontario.ca/content/10103) | 5 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [10225](https://h5pstudio.ecampusontario.ca/content/10225) | 6 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [10228](https://h5pstudio.ecampusontario.ca/content/10228) | 8 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [10527](https://h5pstudio.ecampusontario.ca/content/10527) | 3 | 0 | 0 | 1 | 有 | 缺多选；缺填空；含未支持题型 | site-audit-2026-10-03T05-30-14.463Z |
| [10657](https://h5pstudio.ecampusontario.ca/content/10657) | 7 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [10663](https://h5pstudio.ecampusontario.ca/content/10663) | 10 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [11069](https://h5pstudio.ecampusontario.ca/content/11069) | 9 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [11146](https://h5pstudio.ecampusontario.ca/content/11146) | 8 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [11248](https://h5pstudio.ecampusontario.ca/content/11248) | 2 | 1 | 0 | 1 | 无 | 缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [11638](https://h5pstudio.ecampusontario.ca/content/11638) | 7 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [11684](https://h5pstudio.ecampusontario.ca/content/11684) | 10 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [12152](https://h5pstudio.ecampusontario.ca/content/12152) | 10 | 0 | 0 | 0 | 有 | 缺多选；缺填空 | site-audit-2026-10-03T05-30-14.463Z |
| [12161](https://h5pstudio.ecampusontario.ca/content/12161) | 3 | 0 | 0 | 1 | 有 | 缺多选；缺填空；含未支持题型 | site-audit-2026-10-03T05-30-14.463Z |
| [12169](https://h5pstudio.ecampusontario.ca/content/12169) | 0 | 7 | 0 | 0 | 有 | 缺单选；缺填空 | site-audit-2026-10-03T05-30-14.463Z |
| [12189](https://h5pstudio.ecampusontario.ca/content/12189) | 10 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [12242](https://h5pstudio.ecampusontario.ca/content/12242) | 10 | 0 | 0 | 0 | 有 | 缺多选；缺填空 | site-audit-2026-10-03T05-30-14.463Z |
| [12680](https://h5pstudio.ecampusontario.ca/content/12680) | 10 | 0 | 0 | 0 | 有 | 缺多选；缺填空 | site-audit-2026-10-03T05-30-14.463Z |
| [12748](https://h5pstudio.ecampusontario.ca/content/12748) | 10 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [13101](https://h5pstudio.ecampusontario.ca/content/13101) | 9 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [13935](https://h5pstudio.ecampusontario.ca/content/13935) | 0 | 0 | 0 | 2 | 有 | 缺单选；缺多选；缺填空；含未支持题型 | site-audit-2026-10-03T05-30-14.463Z |
| [14587](https://h5pstudio.ecampusontario.ca/content/14587) | 6 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [15219](https://h5pstudio.ecampusontario.ca/content/15219) | 3 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [15807](https://h5pstudio.ecampusontario.ca/content/15807) | 5 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [16352](https://h5pstudio.ecampusontario.ca/content/16352) | — | — | — | — | 未审查 | 登录或访问授权阻断 | site-audit-2026-10-03T05-30-14.463Z |
| [16421](https://h5pstudio.ecampusontario.ca/content/16421) | 2 | 0 | 1 | 1 | 无 | 缺多选；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [16659](https://h5pstudio.ecampusontario.ca/content/16659) | — | — | — | — | 未审查 | 登录或访问授权阻断 | site-audit-2026-10-03T05-30-14.463Z |
| [16815](https://h5pstudio.ecampusontario.ca/content/16815) | 1 | 0 | 2 | 1 | 有 | 缺多选；含未支持题型 | site-audit-2026-10-03T05-30-14.463Z |
| [16891](https://h5pstudio.ecampusontario.ca/content/16891) | 2 | 0 | 2 | 0 | 无 | 缺多选；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [17244](https://h5pstudio.ecampusontario.ca/content/17244) | 2 | 0 | 3 | 2 | 无 | 缺多选；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [17282](https://h5pstudio.ecampusontario.ca/content/17282) | 4 | 0 | 1 | 0 | 无 | 缺多选；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [17670](https://h5pstudio.ecampusontario.ca/content/17670) | 7 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [17888](https://h5pstudio.ecampusontario.ca/content/17888) | 6 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [18139](https://h5pstudio.ecampusontario.ca/content/18139) | 9 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [18253](https://h5pstudio.ecampusontario.ca/content/18253) | 4 | 1 | 0 | 0 | 无 | 缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [18353](https://h5pstudio.ecampusontario.ca/content/18353) | 2 | 1 | 0 | 1 | 无 | 缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [18900](https://h5pstudio.ecampusontario.ca/content/18900) | 6 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [18901](https://h5pstudio.ecampusontario.ca/content/18901) | 5 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [19534](https://h5pstudio.ecampusontario.ca/content/19534) | 10 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [19684](https://h5pstudio.ecampusontario.ca/content/19684) | 10 | 4 | 2 | 1 | 有 | 含未支持题型 | site-audit-2026-10-03T05-30-14.463Z |
| [19823](https://h5pstudio.ecampusontario.ca/content/19823) | 6 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [20358](https://h5pstudio.ecampusontario.ca/content/20358) | 6 | 0 | 0 | 0 | 有 | 缺多选；缺填空 | site-audit-2026-10-03T05-30-14.463Z |
| [20843](https://h5pstudio.ecampusontario.ca/content/20843) | 3 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [21282](https://h5pstudio.ecampusontario.ca/content/21282) | 10 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [22181](https://h5pstudio.ecampusontario.ca/content/22181) | 3 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [22615](https://h5pstudio.ecampusontario.ca/content/22615) | 6 | 0 | 0 | 0 | 有 | 缺多选；缺填空 | site-audit-2026-10-03T05-30-14.463Z |
| [22622](https://h5pstudio.ecampusontario.ca/content/22622) | 5 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [22626](https://h5pstudio.ecampusontario.ca/content/22626) | 4 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [22687](https://h5pstudio.ecampusontario.ca/content/22687) | 10 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [22869](https://h5pstudio.ecampusontario.ca/content/22869) | 0 | 0 | 0 | 1 | 无 | 缺单选；缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [23758](https://h5pstudio.ecampusontario.ca/content/23758) | 3 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [23764](https://h5pstudio.ecampusontario.ca/content/23764) | 3 | 1 | 0 | 0 | 无 | 缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [24351](https://h5pstudio.ecampusontario.ca/content/24351) | 3 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [24833](https://h5pstudio.ecampusontario.ca/content/24833) | 8 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [25626](https://h5pstudio.ecampusontario.ca/content/25626) | 0 | 0 | 0 | 4 | 无 | 缺单选；缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [25632](https://h5pstudio.ecampusontario.ca/content/25632) | 2 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [25742](https://h5pstudio.ecampusontario.ca/content/25742) | 1 | 0 | 1 | 1 | 有 | 缺多选；含未支持题型 | site-audit-2026-10-03T05-30-14.463Z |
| [25752](https://h5pstudio.ecampusontario.ca/content/25752) | 2 | 0 | 0 | 0 | 有 | 缺多选；缺填空 | site-audit-2026-10-03T05-30-14.463Z |
| [27005](https://h5pstudio.ecampusontario.ca/content/27005) | 0 | 4 | 0 | 0 | 有 | 缺单选；缺填空 | site-audit-2026-10-03T05-30-14.463Z |
| [29087](https://h5pstudio.ecampusontario.ca/content/29087) | 0 | 0 | 0 | 2 | 无 | 缺单选；缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [29093](https://h5pstudio.ecampusontario.ca/content/29093) | 0 | 0 | 0 | 3 | 无 | 缺单选；缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [29097](https://h5pstudio.ecampusontario.ca/content/29097) | 0 | 0 | 0 | 2 | 无 | 缺单选；缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [29102](https://h5pstudio.ecampusontario.ca/content/29102) | 0 | 0 | 0 | 2 | 无 | 缺单选；缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [29197](https://h5pstudio.ecampusontario.ca/content/29197) | 0 | 0 | 0 | 3 | 无 | 缺单选；缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [29210](https://h5pstudio.ecampusontario.ca/content/29210) | 0 | 0 | 0 | 2 | 无 | 缺单选；缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [30213](https://h5pstudio.ecampusontario.ca/content/30213) | 0 | 0 | 0 | 2 | 无 | 缺单选；缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [30223](https://h5pstudio.ecampusontario.ca/content/30223) | 0 | 0 | 0 | 3 | 无 | 缺单选；缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [30253](https://h5pstudio.ecampusontario.ca/content/30253) | 7 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [30290](https://h5pstudio.ecampusontario.ca/content/30290) | 0 | 0 | 0 | 3 | 无 | 缺单选；缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [30412](https://h5pstudio.ecampusontario.ca/content/30412) | 5 | 1 | 0 | 0 | 无 | 缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [30822](https://h5pstudio.ecampusontario.ca/content/30822) | 0 | 0 | 0 | 2 | 无 | 缺单选；缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [31606](https://h5pstudio.ecampusontario.ca/content/31606) | 6 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [31781](https://h5pstudio.ecampusontario.ca/content/31781) | 0 | 0 | 0 | 2 | 无 | 缺单选；缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [31784](https://h5pstudio.ecampusontario.ca/content/31784) | 4 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [32163](https://h5pstudio.ecampusontario.ca/content/32163) | 4 | 1 | 0 | 0 | 无 | 缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [33304](https://h5pstudio.ecampusontario.ca/content/33304) | 5 | 1 | 0 | 0 | 有 | 缺填空 | site-audit-2026-10-03T05-30-14.463Z |
| [34622](https://h5pstudio.ecampusontario.ca/content/34622) | 7 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [35216](https://h5pstudio.ecampusontario.ca/content/35216) | 0 | 4 | 0 | 0 | 无 | 缺单选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [38449](https://h5pstudio.ecampusontario.ca/content/38449) | 12 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [40050](https://h5pstudio.ecampusontario.ca/content/40050) | 2 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [40239](https://h5pstudio.ecampusontario.ca/content/40239) | 1 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [40241](https://h5pstudio.ecampusontario.ca/content/40241) | 4 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [40515](https://h5pstudio.ecampusontario.ca/content/40515) | 0 | 1 | 0 | 0 | 无 | 缺单选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [41098](https://h5pstudio.ecampusontario.ca/content/41098) | 4 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [41120](https://h5pstudio.ecampusontario.ca/content/41120) | 4 | 2 | 0 | 0 | 无 | 缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [41135](https://h5pstudio.ecampusontario.ca/content/41135) | 4 | 1 | 0 | 0 | 无 | 缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [41344](https://h5pstudio.ecampusontario.ca/content/41344) | 5 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [44308](https://h5pstudio.ecampusontario.ca/content/44308) | 2 | 1 | 0 | 0 | 无 | 缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [45965](https://h5pstudio.ecampusontario.ca/content/45965) | — | — | — | — | 未审查 | 登录或访问授权阻断 | site-audit-2026-10-03T05-30-14.463Z |
| [46279](https://h5pstudio.ecampusontario.ca/content/46279) | 4 | 0 | 0 | 4 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [46670](https://h5pstudio.ecampusontario.ca/content/46670) | 7 | 0 | 0 | 8 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [46673](https://h5pstudio.ecampusontario.ca/content/46673) | 0 | 0 | 0 | 6 | 无 | 缺单选；缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [48862](https://h5pstudio.ecampusontario.ca/content/48862) | 4 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [49630](https://h5pstudio.ecampusontario.ca/content/49630) | 5 | 0 | 1 | 1 | 无 | 缺多选；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [49736](https://h5pstudio.ecampusontario.ca/content/49736) | 0 | 7 | 0 | 0 | 有 | 缺单选；缺填空 | site-audit-2026-10-03T05-30-14.463Z |
| [50217](https://h5pstudio.ecampusontario.ca/content/50217) | 3 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [50266](https://h5pstudio.ecampusontario.ca/content/50266) | 6 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [50472](https://h5pstudio.ecampusontario.ca/content/50472) | 10 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [50474](https://h5pstudio.ecampusontario.ca/content/50474) | 7 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [52427](https://h5pstudio.ecampusontario.ca/content/52427) | 10 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [52464](https://h5pstudio.ecampusontario.ca/content/52464) | 0 | 0 | 0 | 7 | 无 | 缺单选；缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [52617](https://h5pstudio.ecampusontario.ca/content/52617) | — | — | — | — | 未审查 | 登录或访问授权阻断 | site-audit-2026-10-03T05-30-14.463Z |
| [54171](https://h5pstudio.ecampusontario.ca/content/54171) | 0 | 0 | 0 | 11 | 无 | 缺单选；缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [55090](https://h5pstudio.ecampusontario.ca/content/55090) | 3 | 0 | 3 | 12 | 有 | 缺多选；含未支持题型 | site-audit-2026-10-03T05-30-14.463Z |
| [56198](https://h5pstudio.ecampusontario.ca/content/56198) | 0 | 0 | 0 | 3 | 无 | 缺单选；缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [56202](https://h5pstudio.ecampusontario.ca/content/56202) | 2 | 0 | 0 | 2 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [56206](https://h5pstudio.ecampusontario.ca/content/56206) | 1 | 1 | 0 | 1 | 无 | 缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [56216](https://h5pstudio.ecampusontario.ca/content/56216) | 5 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [56217](https://h5pstudio.ecampusontario.ca/content/56217) | 2 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [56219](https://h5pstudio.ecampusontario.ca/content/56219) | 0 | 0 | 0 | 2 | 无 | 缺单选；缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [56220](https://h5pstudio.ecampusontario.ca/content/56220) | 0 | 0 | 0 | 1 | 无 | 缺单选；缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [56221](https://h5pstudio.ecampusontario.ca/content/56221) | 0 | 0 | 0 | 2 | 无 | 缺单选；缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [56222](https://h5pstudio.ecampusontario.ca/content/56222) | 2 | 0 | 0 | 3 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [56224](https://h5pstudio.ecampusontario.ca/content/56224) | 0 | 0 | 0 | 1 | 无 | 缺单选；缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [56225](https://h5pstudio.ecampusontario.ca/content/56225) | 0 | 0 | 0 | 4 | 无 | 缺单选；缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [57067](https://h5pstudio.ecampusontario.ca/content/57067) | 3 | 1 | 0 | 0 | 无 | 缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [57110](https://h5pstudio.ecampusontario.ca/content/57110) | 4 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [57117](https://h5pstudio.ecampusontario.ca/content/57117) | 0 | 8 | 0 | 0 | 有 | 缺单选；缺填空 | site-audit-2026-10-03T05-30-14.463Z |
| [57169](https://h5pstudio.ecampusontario.ca/content/57169) | 3 | 2 | 0 | 0 | 无 | 缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [57175](https://h5pstudio.ecampusontario.ca/content/57175) | 3 | 2 | 0 | 0 | 无 | 缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [57587](https://h5pstudio.ecampusontario.ca/content/57587) | — | — | — | — | 未审查 | 登录或访问授权阻断 | site-audit-2026-10-03T05-30-14.463Z |
| [58594](https://h5pstudio.ecampusontario.ca/content/58594) | 15 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [58605](https://h5pstudio.ecampusontario.ca/content/58605) | 1 | 0 | 3 | 0 | 无 | 缺多选；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [58612](https://h5pstudio.ecampusontario.ca/content/58612) | 4 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [58614](https://h5pstudio.ecampusontario.ca/content/58614) | 4 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [60175](https://h5pstudio.ecampusontario.ca/content/60175) | 2 | 0 | 1 | 0 | 无 | 缺多选；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [60209](https://h5pstudio.ecampusontario.ca/content/60209) | 4 | 0 | 0 | 0 | 有 | 缺多选；缺填空 | site-audit-2026-10-03T05-30-14.463Z |
| [60222](https://h5pstudio.ecampusontario.ca/content/60222) | — | — | — | — | 未审查 | 登录或访问授权阻断 | site-audit-2026-10-03T05-30-14.463Z |
| [60259](https://h5pstudio.ecampusontario.ca/content/60259) | 4 | 0 | 1 | 4 | 无 | 缺多选；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [61042](https://h5pstudio.ecampusontario.ca/content/61042) | 5 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [63996](https://h5pstudio.ecampusontario.ca/content/63996) | 0 | 4 | 0 | 0 | 无 | 缺单选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [65301](https://h5pstudio.ecampusontario.ca/content/65301) | 0 | 2 | 0 | 0 | 无 | 缺单选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [65306](https://h5pstudio.ecampusontario.ca/content/65306) | 0 | 2 | 0 | 0 | 无 | 缺单选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [65308](https://h5pstudio.ecampusontario.ca/content/65308) | 0 | 2 | 0 | 0 | 无 | 缺单选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [66308](https://h5pstudio.ecampusontario.ca/content/66308) | 3 | 0 | 1 | 1 | 无 | 缺多选；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [66889](https://h5pstudio.ecampusontario.ca/content/66889) | 4 | 0 | 4 | 0 | 无 | 缺多选；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [68295](https://h5pstudio.ecampusontario.ca/content/68295) | 5 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [68505](https://h5pstudio.ecampusontario.ca/content/68505) | 5 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [68854](https://h5pstudio.ecampusontario.ca/content/68854) | — | — | — | — | 未审查 | 登录或访问授权阻断 | site-audit-2026-10-03T05-30-14.463Z |
| [69450](https://h5pstudio.ecampusontario.ca/content/69450) | 4 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [69619](https://h5pstudio.ecampusontario.ca/content/69619) | 5 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [69622](https://h5pstudio.ecampusontario.ca/content/69622) | 4 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [70296](https://h5pstudio.ecampusontario.ca/content/70296) | 3 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [71118](https://h5pstudio.ecampusontario.ca/content/71118) | 10 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [71402](https://h5pstudio.ecampusontario.ca/content/71402) | 4 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [72159](https://h5pstudio.ecampusontario.ca/content/72159) | 10 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [73103](https://h5pstudio.ecampusontario.ca/content/73103) | 2 | 3 | 0 | 0 | 无 | 缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [73191](https://h5pstudio.ecampusontario.ca/content/73191) | 7 | 0 | 0 | 3 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [73233](https://h5pstudio.ecampusontario.ca/content/73233) | 9 | 0 | 0 | 2 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [73331](https://h5pstudio.ecampusontario.ca/content/73331) | 6 | 0 | 0 | 2 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [74772](https://h5pstudio.ecampusontario.ca/content/74772) | 2 | 0 | 1 | 1 | 无 | 缺多选；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [76212](https://h5pstudio.ecampusontario.ca/content/76212) | — | — | — | — | 未审查 | 登录或访问授权阻断 | site-audit-2026-10-03T05-30-14.463Z |
| [77327](https://h5pstudio.ecampusontario.ca/content/77327) | 10 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [77334](https://h5pstudio.ecampusontario.ca/content/77334) | 4 | 0 | 1 | 0 | 无 | 缺多选；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [77344](https://h5pstudio.ecampusontario.ca/content/77344) | 2 | 0 | 1 | 1 | 无 | 缺多选；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [77368](https://h5pstudio.ecampusontario.ca/content/77368) | 0 | 2 | 0 | 1 | 无 | 缺单选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [78091](https://h5pstudio.ecampusontario.ca/content/78091) | 11 | 3 | 0 | 6 | 有 | 缺填空；含未支持题型 | site-audit-2026-10-03T05-30-14.463Z |
| [78152](https://h5pstudio.ecampusontario.ca/content/78152) | 15 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [78257](https://h5pstudio.ecampusontario.ca/content/78257) | 16 | 1 | 0 | 8 | 有 | 缺填空；含未支持题型 | site-audit-2026-10-03T05-30-14.463Z |
| [79485](https://h5pstudio.ecampusontario.ca/content/79485) | 3 | 0 | 2 | 0 | 无 | 缺多选；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [79486](https://h5pstudio.ecampusontario.ca/content/79486) | 8 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [79586](https://h5pstudio.ecampusontario.ca/content/79586) | 10 | 0 | 0 | 0 | 有 | 缺多选；缺填空 | site-audit-2026-10-03T05-30-14.463Z |
| [80040](https://h5pstudio.ecampusontario.ca/content/80040) | 13 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [80167](https://h5pstudio.ecampusontario.ca/content/80167) | 10 | 0 | 0 | 0 | 有 | 缺多选；缺填空 | site-audit-2026-10-03T05-30-14.463Z |
| [80168](https://h5pstudio.ecampusontario.ca/content/80168) | 10 | 0 | 0 | 0 | 有 | 缺多选；缺填空 | site-audit-2026-10-03T05-30-14.463Z |
| [80410](https://h5pstudio.ecampusontario.ca/content/80410) | 13 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [81042](https://h5pstudio.ecampusontario.ca/content/81042) | 5 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [81632](https://h5pstudio.ecampusontario.ca/content/81632) | — | — | — | — | 未审查 | 登录或访问授权阻断 | site-audit-2026-10-03T05-30-14.463Z |
| [81637](https://h5pstudio.ecampusontario.ca/content/81637) | 10 | 0 | 0 | 0 | 有 | 缺多选；缺填空 | site-audit-2026-10-03T05-30-14.463Z |
| [81646](https://h5pstudio.ecampusontario.ca/content/81646) | 7 | 0 | 0 | 0 | 有 | 缺多选；缺填空 | site-audit-2026-10-03T05-30-14.463Z |
| [82242](https://h5pstudio.ecampusontario.ca/content/82242) | — | — | — | — | 未审查 | 登录或访问授权阻断 | site-audit-2026-10-03T05-30-14.463Z |
| [85162](https://h5pstudio.ecampusontario.ca/content/85162) | 3 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [85164](https://h5pstudio.ecampusontario.ca/content/85164) | 3 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [85165](https://h5pstudio.ecampusontario.ca/content/85165) | 3 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [85166](https://h5pstudio.ecampusontario.ca/content/85166) | 3 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [85172](https://h5pstudio.ecampusontario.ca/content/85172) | 10 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [85237](https://h5pstudio.ecampusontario.ca/content/85237) | 4 | 2 | 0 | 0 | 无 | 缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [85253](https://h5pstudio.ecampusontario.ca/content/85253) | 3 | 1 | 0 | 0 | 无 | 缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [85254](https://h5pstudio.ecampusontario.ca/content/85254) | 2 | 2 | 0 | 0 | 无 | 缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [85357](https://h5pstudio.ecampusontario.ca/content/85357) | 5 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [85384](https://h5pstudio.ecampusontario.ca/content/85384) | 4 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [85385](https://h5pstudio.ecampusontario.ca/content/85385) | 0 | 0 | 0 | 4 | 无 | 缺单选；缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [85403](https://h5pstudio.ecampusontario.ca/content/85403) | 5 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [85405](https://h5pstudio.ecampusontario.ca/content/85405) | 5 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [85409](https://h5pstudio.ecampusontario.ca/content/85409) | 8 | 1 | 0 | 0 | 无 | 缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [85416](https://h5pstudio.ecampusontario.ca/content/85416) | 8 | 1 | 0 | 0 | 无 | 缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [85422](https://h5pstudio.ecampusontario.ca/content/85422) | 6 | 3 | 0 | 0 | 无 | 缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [85427](https://h5pstudio.ecampusontario.ca/content/85427) | 0 | 0 | 2 | 0 | 无 | 缺单选；缺多选；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [85544](https://h5pstudio.ecampusontario.ca/content/85544) | 0 | 3 | 0 | 1 | 无 | 缺单选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [85720](https://h5pstudio.ecampusontario.ca/content/85720) | 12 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [86384](https://h5pstudio.ecampusontario.ca/content/86384) | 5 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [86385](https://h5pstudio.ecampusontario.ca/content/86385) | 11 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [86394](https://h5pstudio.ecampusontario.ca/content/86394) | 8 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [86395](https://h5pstudio.ecampusontario.ca/content/86395) | 10 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [86419](https://h5pstudio.ecampusontario.ca/content/86419) | 0 | 0 | 0 | 3 | 无 | 缺单选；缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [86451](https://h5pstudio.ecampusontario.ca/content/86451) | 16 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [86452](https://h5pstudio.ecampusontario.ca/content/86452) | 0 | 0 | 0 | 2 | 无 | 缺单选；缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [86457](https://h5pstudio.ecampusontario.ca/content/86457) | 0 | 0 | 0 | 2 | 无 | 缺单选；缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [86460](https://h5pstudio.ecampusontario.ca/content/86460) | 7 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [87578](https://h5pstudio.ecampusontario.ca/content/87578) | 4 | 0 | 0 | 0 | 有 | 缺多选；缺填空 | site-audit-2026-10-03T05-30-14.463Z |
| [88037](https://h5pstudio.ecampusontario.ca/content/88037) | 8 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [88038](https://h5pstudio.ecampusontario.ca/content/88038) | 4 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [88154](https://h5pstudio.ecampusontario.ca/content/88154) | — | — | — | — | 未审查 | 登录或访问授权阻断 | site-audit-2026-10-03T05-30-14.463Z |
| [88306](https://h5pstudio.ecampusontario.ca/content/88306) | 7 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [89461](https://h5pstudio.ecampusontario.ca/content/89461) | 15 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [93368](https://h5pstudio.ecampusontario.ca/content/93368) | 9 | 0 | 0 | 2 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [95435](https://h5pstudio.ecampusontario.ca/content/95435) | 2 | 0 | 1 | 1 | 无 | 缺多选；含未支持题型；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [95539](https://h5pstudio.ecampusontario.ca/content/95539) | 18 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 | site-audit-2026-10-03T05-30-14.463Z |
| [97836](https://h5pstudio.ecampusontario.ca/content/97836) | — | — | — | — | 未审查 | 登录或访问授权阻断 | site-audit-2026-10-03T05-30-14.463Z |

## 13:49 追加候选审查

`site-audit-2026-10-03T05-42-33.966Z/report.json`审查179个实际活动链接，178可分类/1访问阻断。唯一完整受支持三型2360共8题，无题目图片，尚不满足图文同场。网址与前表可能重复，保留此次实际证据，不把筛选名称当许可断言。

| 网站 | 单选 | 多选 | 填空 | 未支持 | 题目图片 | 审查结论 |
|---|---:|---:|---:|---:|---|---|
| [3517](https://h5pstudio.ecampusontario.ca/content/3517) | 8 | 0 | 0 | 0 | 有 | 缺多选；缺填空 |
| [3410](https://h5pstudio.ecampusontario.ca/content/3410) | 5 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [89461](https://h5pstudio.ecampusontario.ca/content/89461) | 15 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [88038](https://h5pstudio.ecampusontario.ca/content/88038) | 4 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [3424](https://h5pstudio.ecampusontario.ca/content/3424) | 10 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [87578](https://h5pstudio.ecampusontario.ca/content/87578) | 4 | 0 | 0 | 0 | 有 | 缺多选；缺填空 |
| [3264](https://h5pstudio.ecampusontario.ca/content/3264) | 10 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [71118](https://h5pstudio.ecampusontario.ca/content/71118) | 10 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [71402](https://h5pstudio.ecampusontario.ca/content/71402) | 4 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [3132](https://h5pstudio.ecampusontario.ca/content/3132) | 9 | 0 | 0 | 0 | 有 | 缺多选；缺填空 |
| [3308](https://h5pstudio.ecampusontario.ca/content/3308) | 3 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 |
| [88037](https://h5pstudio.ecampusontario.ca/content/88037) | 8 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [3286](https://h5pstudio.ecampusontario.ca/content/3286) | 4 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 |
| [88306](https://h5pstudio.ecampusontario.ca/content/88306) | 7 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [86460](https://h5pstudio.ecampusontario.ca/content/86460) | 7 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [2980](https://h5pstudio.ecampusontario.ca/content/2980) | 9 | 1 | 0 | 0 | 无 | 缺填空；未发现题目图片 |
| [2691](https://h5pstudio.ecampusontario.ca/content/2691) | 4 | 0 | 1 | 4 | 无 | 缺多选；含未支持题型；未发现题目图片 |
| [86457](https://h5pstudio.ecampusontario.ca/content/86457) | 0 | 0 | 0 | 2 | 无 | 缺单选；缺多选；缺填空；含未支持题型；未发现题目图片 |
| [86452](https://h5pstudio.ecampusontario.ca/content/86452) | 0 | 0 | 0 | 2 | 无 | 缺单选；缺多选；缺填空；含未支持题型；未发现题目图片 |
| [3248](https://h5pstudio.ecampusontario.ca/content/3248) | 3 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 |
| [86451](https://h5pstudio.ecampusontario.ca/content/86451) | 16 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [86419](https://h5pstudio.ecampusontario.ca/content/86419) | 0 | 0 | 0 | 3 | 无 | 缺单选；缺多选；缺填空；含未支持题型；未发现题目图片 |
| [1643](https://h5pstudio.ecampusontario.ca/content/1643) | 5 | 0 | 1 | 0 | 无 | 缺多选；未发现题目图片 |
| [1460](https://h5pstudio.ecampusontario.ca/content/1460) | 8 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [86395](https://h5pstudio.ecampusontario.ca/content/86395) | 10 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [86394](https://h5pstudio.ecampusontario.ca/content/86394) | 8 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [2997](https://h5pstudio.ecampusontario.ca/content/2997) | 2 | 0 | 0 | 6 | 有 | 缺多选；缺填空；含未支持题型 |
| [2091](https://h5pstudio.ecampusontario.ca/content/2091) | 4 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [86385](https://h5pstudio.ecampusontario.ca/content/86385) | 11 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [86384](https://h5pstudio.ecampusontario.ca/content/86384) | 5 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [2360](https://h5pstudio.ecampusontario.ca/content/2360) | 6 | 1 | 1 | 0 | 无 | 未发现题目图片 |
| [2354](https://h5pstudio.ecampusontario.ca/content/2354) | 6 | 1 | 0 | 0 | 有 | 缺填空 |
| [85166](https://h5pstudio.ecampusontario.ca/content/85166) | 3 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [85165](https://h5pstudio.ecampusontario.ca/content/85165) | 3 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [2323](https://h5pstudio.ecampusontario.ca/content/2323) | 7 | 0 | 0 | 0 | 有 | 缺多选；缺填空 |
| [2003](https://h5pstudio.ecampusontario.ca/content/2003) | 7 | 0 | 0 | 0 | 有 | 缺多选；缺填空 |
| [85164](https://h5pstudio.ecampusontario.ca/content/85164) | 3 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [85162](https://h5pstudio.ecampusontario.ca/content/85162) | 3 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [1900](https://h5pstudio.ecampusontario.ca/content/1900) | 7 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [996](https://h5pstudio.ecampusontario.ca/content/996) | 4 | 1 | 0 | 0 | 有 | 缺填空 |
| [85254](https://h5pstudio.ecampusontario.ca/content/85254) | 2 | 2 | 0 | 0 | 无 | 缺填空；未发现题目图片 |
| [85172](https://h5pstudio.ecampusontario.ca/content/85172) | 10 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [1522](https://h5pstudio.ecampusontario.ca/content/1522) | 4 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [674](https://h5pstudio.ecampusontario.ca/content/674) | 4 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 |
| [85357](https://h5pstudio.ecampusontario.ca/content/85357) | 5 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [85403](https://h5pstudio.ecampusontario.ca/content/85403) | 5 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [1128](https://h5pstudio.ecampusontario.ca/content/1128) | 5 | 0 | 0 | 3 | 有 | 缺多选；缺填空；含未支持题型 |
| [677](https://h5pstudio.ecampusontario.ca/content/677) | 3 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 |
| [85405](https://h5pstudio.ecampusontario.ca/content/85405) | 5 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [85422](https://h5pstudio.ecampusontario.ca/content/85422) | 6 | 3 | 0 | 0 | 无 | 缺填空；未发现题目图片 |
| [805](https://h5pstudio.ecampusontario.ca/content/805) | 4 | 1 | 0 | 0 | 无 | 缺填空；未发现题目图片 |
| [832](https://h5pstudio.ecampusontario.ca/content/832) | 4 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [85427](https://h5pstudio.ecampusontario.ca/content/85427) | 0 | 0 | 2 | 0 | 无 | 缺单选；缺多选；未发现题目图片 |
| [85720](https://h5pstudio.ecampusontario.ca/content/85720) | 12 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [823](https://h5pstudio.ecampusontario.ca/content/823) | 5 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 |
| [693](https://h5pstudio.ecampusontario.ca/content/693) | 6 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 |
| [85384](https://h5pstudio.ecampusontario.ca/content/85384) | 4 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [85385](https://h5pstudio.ecampusontario.ca/content/85385) | 0 | 0 | 0 | 4 | 无 | 缺单选；缺多选；缺填空；含未支持题型；未发现题目图片 |
| [485](https://h5pstudio.ecampusontario.ca/content/485) | 2 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [542](https://h5pstudio.ecampusontario.ca/content/542) | 2 | 0 | 0 | 2 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 |
| [85409](https://h5pstudio.ecampusontario.ca/content/85409) | 8 | 1 | 0 | 0 | 无 | 缺填空；未发现题目图片 |
| [85416](https://h5pstudio.ecampusontario.ca/content/85416) | 8 | 1 | 0 | 0 | 无 | 缺填空；未发现题目图片 |
| [211](https://h5pstudio.ecampusontario.ca/content/211) | 2 | 0 | 0 | 3 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 |
| [185](https://h5pstudio.ecampusontario.ca/content/185) | 2 | 1 | 0 | 0 | 无 | 缺填空；未发现题目图片 |
| [81637](https://h5pstudio.ecampusontario.ca/content/81637) | 10 | 0 | 0 | 0 | 有 | 缺多选；缺填空 |
| [80040](https://h5pstudio.ecampusontario.ca/content/80040) | 13 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 |
| [80410](https://h5pstudio.ecampusontario.ca/content/80410) | 13 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 |
| [79586](https://h5pstudio.ecampusontario.ca/content/79586) | 10 | 0 | 0 | 0 | 有 | 缺多选；缺填空 |
| [80167](https://h5pstudio.ecampusontario.ca/content/80167) | 10 | 0 | 0 | 0 | 有 | 缺多选；缺填空 |
| [81646](https://h5pstudio.ecampusontario.ca/content/81646) | 7 | 0 | 0 | 0 | 有 | 缺多选；缺填空 |
| [80168](https://h5pstudio.ecampusontario.ca/content/80168) | 10 | 0 | 0 | 0 | 有 | 缺多选；缺填空 |
| [85544](https://h5pstudio.ecampusontario.ca/content/85544) | 0 | 3 | 0 | 1 | 无 | 缺单选；缺填空；含未支持题型；未发现题目图片 |
| [85237](https://h5pstudio.ecampusontario.ca/content/85237) | 4 | 2 | 0 | 0 | 无 | 缺填空；未发现题目图片 |
| [85253](https://h5pstudio.ecampusontario.ca/content/85253) | 3 | 1 | 0 | 0 | 无 | 缺填空；未发现题目图片 |
| [3265](https://h5pstudio.ecampusontario.ca/content/3265) | 15 | 1 | 0 | 0 | 无 | 缺填空；未发现题目图片 |
| [4021](https://h5pstudio.ecampusontario.ca/content/4021) | 12 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [72159](https://h5pstudio.ecampusontario.ca/content/72159) | 10 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [78091](https://h5pstudio.ecampusontario.ca/content/78091) | 11 | 3 | 0 | 6 | 有 | 缺填空；含未支持题型 |
| [78257](https://h5pstudio.ecampusontario.ca/content/78257) | 16 | 1 | 0 | 8 | 有 | 缺填空；含未支持题型 |
| [81632](https://h5pstudio.ecampusontario.ca/content/81632) | — | — | — | — | 未审查 | 登录或访问授权阻断 |
| [25742](https://h5pstudio.ecampusontario.ca/content/25742) | 1 | 0 | 1 | 1 | 有 | 缺多选；含未支持题型 |
| [66889](https://h5pstudio.ecampusontario.ca/content/66889) | 4 | 0 | 4 | 0 | 无 | 缺多选；未发现题目图片 |
| [63996](https://h5pstudio.ecampusontario.ca/content/63996) | 0 | 4 | 0 | 0 | 无 | 缺单选；缺填空；未发现题目图片 |
| [6712](https://h5pstudio.ecampusontario.ca/content/6712) | 3 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [58594](https://h5pstudio.ecampusontario.ca/content/58594) | 15 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [58612](https://h5pstudio.ecampusontario.ca/content/58612) | 4 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [58614](https://h5pstudio.ecampusontario.ca/content/58614) | 4 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [58605](https://h5pstudio.ecampusontario.ca/content/58605) | 1 | 0 | 3 | 0 | 无 | 缺多选；未发现题目图片 |
| [49736](https://h5pstudio.ecampusontario.ca/content/49736) | 0 | 7 | 0 | 0 | 有 | 缺单选；缺填空 |
| [951](https://h5pstudio.ecampusontario.ca/content/951) | 1 | 0 | 0 | 2 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 |
| [57117](https://h5pstudio.ecampusontario.ca/content/57117) | 0 | 8 | 0 | 0 | 有 | 缺单选；缺填空 |
| [56216](https://h5pstudio.ecampusontario.ca/content/56216) | 5 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 |
| [1351](https://h5pstudio.ecampusontario.ca/content/1351) | 1 | 0 | 0 | 3 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 |
| [52427](https://h5pstudio.ecampusontario.ca/content/52427) | 10 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [50266](https://h5pstudio.ecampusontario.ca/content/50266) | 6 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [50217](https://h5pstudio.ecampusontario.ca/content/50217) | 3 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 |
| [41135](https://h5pstudio.ecampusontario.ca/content/41135) | 4 | 1 | 0 | 0 | 无 | 缺填空；未发现题目图片 |
| [41344](https://h5pstudio.ecampusontario.ca/content/41344) | 5 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [34622](https://h5pstudio.ecampusontario.ca/content/34622) | 7 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [22869](https://h5pstudio.ecampusontario.ca/content/22869) | 0 | 0 | 0 | 1 | 无 | 缺单选；缺多选；缺填空；含未支持题型；未发现题目图片 |
| [41098](https://h5pstudio.ecampusontario.ca/content/41098) | 4 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 |
| [35216](https://h5pstudio.ecampusontario.ca/content/35216) | 0 | 4 | 0 | 0 | 无 | 缺单选；缺填空；未发现题目图片 |
| [40515](https://h5pstudio.ecampusontario.ca/content/40515) | 0 | 1 | 0 | 0 | 无 | 缺单选；缺填空；未发现题目图片 |
| [40241](https://h5pstudio.ecampusontario.ca/content/40241) | 4 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [40239](https://h5pstudio.ecampusontario.ca/content/40239) | 1 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 |
| [40050](https://h5pstudio.ecampusontario.ca/content/40050) | 2 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 |
| [31606](https://h5pstudio.ecampusontario.ca/content/31606) | 6 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [31781](https://h5pstudio.ecampusontario.ca/content/31781) | 0 | 0 | 0 | 2 | 无 | 缺单选；缺多选；缺填空；含未支持题型；未发现题目图片 |
| [31784](https://h5pstudio.ecampusontario.ca/content/31784) | 4 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [25752](https://h5pstudio.ecampusontario.ca/content/25752) | 2 | 0 | 0 | 0 | 有 | 缺多选；缺填空 |
| [1410](https://h5pstudio.ecampusontario.ca/content/1410) | 2 | 1 | 0 | 0 | 有 | 缺填空 |
| [1444](https://h5pstudio.ecampusontario.ca/content/1444) | 1 | 0 | 0 | 1 | 有 | 缺多选；缺填空；含未支持题型 |
| [5733](https://h5pstudio.ecampusontario.ca/content/5733) | 2 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 |
| [4754](https://h5pstudio.ecampusontario.ca/content/4754) | 3 | 0 | 0 | 0 | 有 | 缺多选；缺填空 |
| [5134](https://h5pstudio.ecampusontario.ca/content/5134) | 4 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [12161](https://h5pstudio.ecampusontario.ca/content/12161) | 3 | 0 | 0 | 1 | 有 | 缺多选；缺填空；含未支持题型 |
| [9828](https://h5pstudio.ecampusontario.ca/content/9828) | 2 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 |
| [8643](https://h5pstudio.ecampusontario.ca/content/8643) | 5 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [11248](https://h5pstudio.ecampusontario.ca/content/11248) | 2 | 1 | 0 | 1 | 无 | 缺填空；含未支持题型；未发现题目图片 |
| [10527](https://h5pstudio.ecampusontario.ca/content/10527) | 3 | 0 | 0 | 1 | 有 | 缺多选；缺填空；含未支持题型 |
| [22687](https://h5pstudio.ecampusontario.ca/content/22687) | 10 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 |
| [22626](https://h5pstudio.ecampusontario.ca/content/22626) | 4 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [22622](https://h5pstudio.ecampusontario.ca/content/22622) | 5 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [22615](https://h5pstudio.ecampusontario.ca/content/22615) | 6 | 0 | 0 | 0 | 有 | 缺多选；缺填空 |
| [22181](https://h5pstudio.ecampusontario.ca/content/22181) | 3 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [8985](https://h5pstudio.ecampusontario.ca/content/8985) | 9 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [947](https://h5pstudio.ecampusontario.ca/content/947) | 4 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [20358](https://h5pstudio.ecampusontario.ca/content/20358) | 6 | 0 | 0 | 0 | 有 | 缺多选；缺填空 |
| [19823](https://h5pstudio.ecampusontario.ca/content/19823) | 6 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [19534](https://h5pstudio.ecampusontario.ca/content/19534) | 10 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [16891](https://h5pstudio.ecampusontario.ca/content/16891) | 2 | 0 | 2 | 0 | 无 | 缺多选；未发现题目图片 |
| [18900](https://h5pstudio.ecampusontario.ca/content/18900) | 6 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [18901](https://h5pstudio.ecampusontario.ca/content/18901) | 5 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [18139](https://h5pstudio.ecampusontario.ca/content/18139) | 9 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [17888](https://h5pstudio.ecampusontario.ca/content/17888) | 6 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [17670](https://h5pstudio.ecampusontario.ca/content/17670) | 7 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [17282](https://h5pstudio.ecampusontario.ca/content/17282) | 4 | 0 | 1 | 0 | 无 | 缺多选；未发现题目图片 |
| [16815](https://h5pstudio.ecampusontario.ca/content/16815) | 1 | 0 | 2 | 1 | 有 | 缺多选；含未支持题型 |
| [9242](https://h5pstudio.ecampusontario.ca/content/9242) | 5 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [14587](https://h5pstudio.ecampusontario.ca/content/14587) | 6 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [15807](https://h5pstudio.ecampusontario.ca/content/15807) | 5 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [13935](https://h5pstudio.ecampusontario.ca/content/13935) | 0 | 0 | 0 | 2 | 有 | 缺单选；缺多选；缺填空；含未支持题型 |
| [13101](https://h5pstudio.ecampusontario.ca/content/13101) | 9 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [12748](https://h5pstudio.ecampusontario.ca/content/12748) | 10 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [12680](https://h5pstudio.ecampusontario.ca/content/12680) | 10 | 0 | 0 | 0 | 有 | 缺多选；缺填空 |
| [12189](https://h5pstudio.ecampusontario.ca/content/12189) | 10 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [12242](https://h5pstudio.ecampusontario.ca/content/12242) | 10 | 0 | 0 | 0 | 有 | 缺多选；缺填空 |
| [12169](https://h5pstudio.ecampusontario.ca/content/12169) | 0 | 7 | 0 | 0 | 有 | 缺单选；缺填空 |
| [11684](https://h5pstudio.ecampusontario.ca/content/11684) | 10 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [11638](https://h5pstudio.ecampusontario.ca/content/11638) | 7 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [11146](https://h5pstudio.ecampusontario.ca/content/11146) | 8 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [11069](https://h5pstudio.ecampusontario.ca/content/11069) | 9 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [10663](https://h5pstudio.ecampusontario.ca/content/10663) | 10 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [10657](https://h5pstudio.ecampusontario.ca/content/10657) | 7 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [10228](https://h5pstudio.ecampusontario.ca/content/10228) | 8 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [10225](https://h5pstudio.ecampusontario.ca/content/10225) | 6 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [9582](https://h5pstudio.ecampusontario.ca/content/9582) | 10 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [9577](https://h5pstudio.ecampusontario.ca/content/9577) | 10 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [9414](https://h5pstudio.ecampusontario.ca/content/9414) | 10 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [9247](https://h5pstudio.ecampusontario.ca/content/9247) | 5 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [9188](https://h5pstudio.ecampusontario.ca/content/9188) | 8 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [3061](https://h5pstudio.ecampusontario.ca/content/3061) | 8 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [6890](https://h5pstudio.ecampusontario.ca/content/6890) | 11 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [6699](https://h5pstudio.ecampusontario.ca/content/6699) | 11 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [876](https://h5pstudio.ecampusontario.ca/content/876) | 7 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 |
| [5433](https://h5pstudio.ecampusontario.ca/content/5433) | 6 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [5387](https://h5pstudio.ecampusontario.ca/content/5387) | 8 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [5374](https://h5pstudio.ecampusontario.ca/content/5374) | 0 | 0 | 10 | 0 | 无 | 缺单选；缺多选；未发现题目图片 |
| [5200](https://h5pstudio.ecampusontario.ca/content/5200) | 4 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 |
| [4736](https://h5pstudio.ecampusontario.ca/content/4736) | 5 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [4711](https://h5pstudio.ecampusontario.ca/content/4711) | 3 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 |
| [1051](https://h5pstudio.ecampusontario.ca/content/1051) | 5 | 0 | 1 | 1 | 无 | 缺多选；含未支持题型；未发现题目图片 |
| [2636](https://h5pstudio.ecampusontario.ca/content/2636) | 9 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [4028](https://h5pstudio.ecampusontario.ca/content/4028) | 9 | 0 | 0 | 0 | 有 | 缺多选；缺填空 |
| [3957](https://h5pstudio.ecampusontario.ca/content/3957) | 7 | 0 | 0 | 0 | 有 | 缺多选；缺填空 |
| [3810](https://h5pstudio.ecampusontario.ca/content/3810) | 3 | 0 | 0 | 1 | 无 | 缺多选；缺填空；含未支持题型；未发现题目图片 |
| [3188](https://h5pstudio.ecampusontario.ca/content/3188) | 20 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [3257](https://h5pstudio.ecampusontario.ca/content/3257) | 10 | 0 | 0 | 0 | 无 | 缺多选；缺填空；未发现题目图片 |
| [3533](https://h5pstudio.ecampusontario.ca/content/3533) | 9 | 0 | 0 | 0 | 有 | 缺多选；缺填空 |

## 17:00 新域名生物学目录审查

[Interactive Biology Textbook目录](https://pressbooks.justwrite.in/interactive-biology-secondary/h5p-listing/)：沿实际hpage下一页链接走完7页，126目录记录、125唯一活动ID、19唯一QuestionSet。公开结构分类、模型调用0；没有同时满足单选、多选、填空和题图且无额外未支持类型的题组。报告 site-audit-2026-10-03T08-41-01.316Z/report.json。

| 活动ID / 实际目录页 | 单选 | 多选 | 填空 | 未支持 | 题图 |
|---|---:|---:|---:|---:|---|
| [cid-4](https://pressbooks.justwrite.in/interactive-biology-secondary/h5p-listing/) | 2 | 0 | 1 | 2 | 有 |
| [cid-11](https://pressbooks.justwrite.in/interactive-biology-secondary/h5p-listing/) | 13 | 0 | 5 | 0 | 无 |
| [cid-21](https://pressbooks.justwrite.in/interactive-biology-secondary/h5p-listing/) | 2 | 0 | 0 | 1 | 无 |
| [cid-22](https://pressbooks.justwrite.in/interactive-biology-secondary/h5p-listing/) | 5 | 0 | 0 | 1 | 无 |
| [cid-23](https://pressbooks.justwrite.in/interactive-biology-secondary/h5p-listing/?hpage=2) | 9 | 1 | 0 | 1 | 无 |
| [cid-25](https://pressbooks.justwrite.in/interactive-biology-secondary/h5p-listing/?hpage=2) | 5 | 0 | 0 | 1 | 无 |
| [cid-45](https://pressbooks.justwrite.in/interactive-biology-secondary/h5p-listing/?hpage=3) | 2 | 0 | 0 | 1 | 无 |
| [cid-46](https://pressbooks.justwrite.in/interactive-biology-secondary/h5p-listing/?hpage=3) | 4 | 0 | 0 | 0 | 无 |
| [cid-52](https://pressbooks.justwrite.in/interactive-biology-secondary/h5p-listing/?hpage=3) | 20 | 0 | 2 | 3 | 有 |
| [cid-71](https://pressbooks.justwrite.in/interactive-biology-secondary/h5p-listing/?hpage=4) | 4 | 0 | 0 | 1 | 无 |
| [cid-83](https://pressbooks.justwrite.in/interactive-biology-secondary/h5p-listing/?hpage=4) | 1 | 0 | 0 | 0 | 无 |
| [cid-84](https://pressbooks.justwrite.in/interactive-biology-secondary/h5p-listing/?hpage=5) | 4 | 0 | 0 | 0 | 无 |
| [cid-88](https://pressbooks.justwrite.in/interactive-biology-secondary/h5p-listing/?hpage=5) | 1 | 0 | 2 | 0 | 无 |
| [cid-90](https://pressbooks.justwrite.in/interactive-biology-secondary/h5p-listing/?hpage=5) | 4 | 0 | 0 | 0 | 有 |
| [cid-95](https://pressbooks.justwrite.in/interactive-biology-secondary/h5p-listing/?hpage=5) | 3 | 0 | 0 | 0 | 无 |
| [cid-101](https://pressbooks.justwrite.in/interactive-biology-secondary/h5p-listing/?hpage=5) | 2 | 0 | 0 | 3 | 有 |
| [cid-116](https://pressbooks.justwrite.in/interactive-biology-secondary/h5p-listing/?hpage=6) | 4 | 0 | 0 | 0 | 无 |
| [cid-128](https://pressbooks.justwrite.in/interactive-biology-secondary/h5p-listing/?hpage=7) | 3 | 0 | 0 | 1 | 无 |
| [cid-129](https://pressbooks.justwrite.in/interactive-biology-secondary/h5p-listing/?hpage=7) | 4 | 0 | 0 | 2 | 无 |

[UFL H5P例子页](https://ufl.pb.unizin.org/msmpstyleguide/chapter/h5p-examples-2/)在site-audit-2026-10-03T06-12-23.346Z首审无可分类活动，08-41-01.316Z复审导航未完成；不能宣称类型或闭环通过。

H5PStudio此前site-audit-2026-10-03T05-59-58.152Z的265个活动均与已记录296唯一网址重复，未增加严格候选；筛选参数不替代实际内容或许可核查。

[MSU生物学目录](https://openbooks.lib.msu.edu/isb202/h5p-listing/)与[LibreStudio安全题库](https://studio.libretexts.org/library?tags=safety)已记录在site-audit-2026-10-03T08-54-27.542Z：前者浏览器导航未完成，后者目录可访问但未取得活动分类；当前补充加载诊断08-59-33.151Z，以最终报告为准，不记答题通过。
