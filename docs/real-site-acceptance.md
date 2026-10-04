# 真实网站验收记录（2026-09-23）

## 2026-10-03 17:56 当前修复真实整场通过，已暂停

- 报告`.browser-regression-runtime/background-2026-10-03T09-51-52.265Z/report.json`退出0，优先`gemini-3.8-flash-high`、独立隐藏Chrome、两站并行。公开[Microteaching八题](https://h5pstudio.ecampusontario.ca/content/2360)total8/answered8/failed0/guessed0/retried5、13调用、COMPLETE，实际成绩9/9；新Finish一次重新观察绑定、一次提交、一次最终VERIFY。PNG `h5p-mixed-text.png`已实际打开确认Your result 9/9，没有点击解答。
- 并行[H5P图片多选1039075](https://h5p.org/h5p/embed/1039075)COMPLETE1题、实际4/4、1调用；PNG `h5p-image-multi.png`已实际查看。独立活动不能拼成严格混合单场；2360没有题目图片，Edge/监督的新闭环仍需续做。
- 评分公告/动画旧分数、Retry未核验清空、禁用后移除角色、动态Finish绑定及单题/整场角色误认均已修复。完整34文件/263项和类型检查通过。实际模型私有构建在最后“旧单题分数不代替completed”的负例之前，但正路径实际completed=true/9/9，证据边界记录于WORK_CHECKPOINT。
- `09-34-02.094Z`七题末题失败、`09-42-29.873Z`八题缺Finish失败、`09-49-01.605Z`旧构建主动停止均保留原退出1；零模型Finish探针`09-50-40.358Z`诊断旧题错误和`09-51-50.793Z`最终截图超时均整体失败，不以单项passed字段替代整份通过。
- 按用户直接要求暂停，全部自有测试句柄已终止；不操作用户人工记录器/浏览器/CMD/dist，无删除。完整1.2.0尚未完成，恢复点和剩余门槛详见WORK_CHECKPOINT与RELEASE_PROGRESS。

## 2026-10-03 17:00 当前题评分与重试复核

- [实际公开八题Microteaching](https://h5pstudio.ecampusontario.ca/content/2360)第二题，`h5p-grading-probe-2026-10-03T08-52-07.018Z`退出0：只用前面失败场模型候选3，网站公开0/1、输入aria标签Answered incorrectly；VV反馈incorrect，评分前后及Retry后指纹64e3c29a相同，实际Retry成功清空输入。未读取隐藏正确答案/打开解答，模型调用0，不是整场通过。
- 同题组第一判断题，`h5p-grading-probe-2026-10-03T08-58-28.961Z`退出0：Check被移除后的公开1/1正确反馈可读，题指纹c652dc77稳定。先前第一判断题评分读取失败及填空失败报告全部保留。
- 适配依据是实际可见DOM：评分条文字必须与SVG标题分离；动态Checking mode状态不能进入填空题干；被移除的Check无法用closest回到题目，需仍连接/可见的当前题控件。没有降低新鲜度或VERIFY要求。34文件/252项与类型检查通过。
- 复核更正：`background-2026-10-03T06-10-55.825Z/canvas-fill-repainted.png`、`06-08-12.933Z/canvas-fill-settled.png`、`06-02-54.029Z/canvas-fill-settled.png`原图均完整清晰Final score 1/1，之前“左侧不完整”的判读撤回，原文件未改写。两浏览器直接CDP`canvas-result-probe-08-43-17.411Z`和实际产品transport`capture-probe-08-45-49.210Z`对照原始画布/截图均正常，零模型，不把本机输入探针替代真实VLM验收。
- 优先3.8 `background-2026-10-03T08-53-03.069Z`整体退出1：上述Check父题缺陷修复前第一题submit_unverified；图片页尚未完成导航就触发权限拒绝。测试器新增自有目标导航45秒限时、真实origin检查，权限保护保持。修复后的新场以最终报告为准。

## 2026-10-03 14:03 真实多选四组合与公开题组终点

- 新优先3.8 `background-2026-10-03T05-59-01.251Z`Edge无人值守和`05-59-03.370Z`Chrome监督本机多选均严格total1/answered1、实际2/2；稳定PNG已实际查看。连同前面Chrome无人值守、Edge监督，真实多选四组合有正确计数与最终成绩；并行单选/填空503整体失败。真实填空稳定图和完整三型组合仍缺。
- `background-2026-10-03T05-47-39.385Z`Chrome监督授权3.1的多选原报告passed=true，但total2/answered1不符合一题，复审排除，原文件保留。控件Submit quiz角色session_submit→submit漂移导致重观察；新增硬暂停与未知总数重复观察不增题，测试器要求total精确。
- [公开Microteaching八题](https://h5pstudio.ecampusontario.ca/content/2360)包含六单选/一多选/一填空，无题图，不能满足严格图文同场。`05-53-30.093Z`首题1/1误COMPLETE，严格8题失败、实际PNG仍第一题/下一题箭头。`site-audit-2026-10-03T05-56-42.490Z`读取实际可见导航与ARIA圆点，已修复Next question标签、总数8与单题得分不当整场完成。修复后`05-58-48.112Z`读total8但优先3.8求解503，原失败保持；后续整场仍验证中。[H5P官方源码](https://github.com/h5p/h5p-question-set/blob/master/js/questionset.js)也区分子题完成和整场结果，适配依据以本机实际DOM为准。

## 2026-10-03 13:45 候选清单与真实视觉多选

- [公开候选清单](public-quiz-candidates.md)记录272个唯一H5PStudio网址、题型计数、题目图片与排除原因。`site-audit-2026-10-03T05-30-14.463Z`终止0：15个实际目录页、260可分类/12访问阻断、模型调用0。19684含单选10/多选4/填空2和题图，但另有拖词未支持，不能跳过后计整场通过。元数据审查不是VV答题验收。
- 新结构提示后，优先3.8的Chrome无人值守`background-2026-10-03T05-40-45.778Z`真实本机多选COMPLETE 1/1、实际2/2，两项和提交共3次trusted点击、0复核失败；填空Alpha/1/1也通过。原多选PNG实际查看2/2，填空即时PNG左侧文字不完整，保留并列视觉复核缺口，不因此宣布完整视觉质量。并行单选503导致整体退出1。
- Edge监督`05-43-51.881Z`采用授权3.7（3.8的`05-40-47.912Z`三路连续503），单选1/1、多选1/1与实际2/2通过，两个稳定PNG实际查看；并行填空503，整体退出1。此前`05-36-28.643Z`Edge监督3.8填空通过/多选限制漂移硬暂停，原报告保留。
- 识别只携带本场之前的结构提示，不给旧选中状态、答案或坐标；当前像素独立复核和选择限制漂移阻断不放松。完整34文件/239项通过、类型检查通过；真实视觉其余组合/严格混合单场/公共限时仍未完成，正式0.1.0不升版。

## 2026-10-03 13:19 公共Canvas四组合完整终点

同一[公开Wordwall科学五题](https://wordwall.net/resource/114600206/general-science-quiz)，均自己的隐藏浏览器、[图片活动](https://h5p.org/h5p/embed/1249570)并行，无用户鼠标/桌面焦点或排行榜录入，稳定终点PNG已分别实际查看：

| 浏览器 / 策略 | 报告目录 background-2026-10-03T | 真实模型 | Canvas / 并行图片 | 整体退出 |
| --- | --- | --- | --- | --- |
| Chrome 无人值守 | 04-47-58.693Z | Gemini3.8Flash | COMPLETE 5/5、稳定5/5；图片4/4 | 0 |
| Chrome 监督 | 04-58-13.181Z | Gemini3.7Flash，3.8视觉503后授权备选 | COMPLETE 5/5、稳定5/5；图片4/4 | 0 |
| Edge 无人值守 | 04-58-15.885Z | Gemini3.7Flash，同上 | COMPLETE 5/5、稳定5/5；图片503暂停 | 1，保留图片失败 |
| Edge 监督 | 05-14-28.171Z | Gemini3.8Flash | COMPLETE 5/5、稳定5/5/44.0s；图片4/4 | 0 |

补图没有任何输入/模型/激活标签，只在产品已经COMPLETE后让自己的帧生产及模拟焦点保持5秒再释放。原即时图和读数保留。旧Edge监督`05-01-33.073Z`末题服务挂起至观察截止4/5停止失败保留；新增Provider请求120秒截止后，新的真实3.8场完成，不改旧报告。上述是公共单选Canvas四组合，其他真实视觉题型及全部1.2.0门槛继续。

- 新H5PStudio公开候选审查`04-57-12.508Z`、`05-01-32.835Z`、`05-04-43.030Z`、`05-11-12.042Z`：实际[95435](https://h5pstudio.ecampusontario.ca/content/95435)两单选/填空/拖词，无题图；[95539](https://h5pstudio.ecampusontario.ca/content/95539)18单选无图；[87578](https://h5pstudio.ecampusontario.ca/content/87578)四单选有图；[185](https://h5pstudio.ecampusontario.ca/content/185)两单选/一多选无填空图；[904](https://h5pstudio.ecampusontario.ca/content/904)两单选/两填空/拖词；[16421](https://h5pstudio.ecampusontario.ca/content/16421)单选/填空/拖放；[55090](https://h5pstudio.ecampusontario.ca/content/55090)3单选/3填空/12未支持，有题图；[21630](https://h5pstudio.ecampusontario.ca/content/21630)十单选有图；[7599](https://h5pstudio.ecampusontario.ca/content/7599)12判断；[674](https://h5pstudio.ecampusontario.ca/content/674)/[832](https://h5pstudio.ecampusontario.ca/content/832)/[66308](https://h5pstudio.ecampusontario.ca/content/66308)仍缺多选/填空/图或有拖词拖放。[88038](https://h5pstudio.ecampusontario.ca/content/88038)/[86460](https://h5pstudio.ecampusontario.ca/content/86460)只有单选，[86457](https://h5pstudio.ecampusontario.ca/content/86457)只有拖词。[20843](https://h5pstudio.ecampusontario.ca/content/20843)/[9828](https://h5pstudio.ecampusontario.ca/content/9828)含未支持且缺混合。均只读，不记答题通过。
- [52617](https://h5pstudio.ecampusontario.ca/content/52617)、[57587](https://h5pstudio.ecampusontario.ca/content/57587)、[45965](https://h5pstudio.ecampusontario.ca/content/45965)、[68854](https://h5pstudio.ecampusontario.ca/content/68854)、[33116](https://h5pstudio.ecampusontario.ca/content/33116)明确Login Required，排除，未分类隐藏活动或跟踪嵌入。[H5P官方旧示例248365](https://h5p.org/node/248365)只有判断+多选，无填空图。目录筛选mixed/example不等于题型合格。

## 2026-10-03 12:53 首场公共Canvas稳定终点及H5PStudio目录

- [Wordwall科学五题](https://wordwall.net/resource/114600206/general-science-quiz)和[H5P图片多选](https://h5p.org/h5p/embed/1249570)并行：`background-2026-10-03T04-47-58.693Z/`退出0，隐藏Chrome无人值守、Gemini3.8Flash，VV COMPLETE 5/5与4/4。实际查看`wordwall-science-settled.png`：GAME COMPLETE、Score 5/5、Time 42.8s。补图只等待自己目标5秒、零额外输入/模型，原即时图保留。首场真实公共Canvas稳定视觉终点通过，不能替代其他浏览器/策略及全部题型。
- `background-2026-10-03T04-41-37.833Z/`Edge监督运行COMPLETE 5/5、图片4/4，0验证失败，但即时Canvas图为过渡，尚缺稳定成绩图；`04-39-29.474Z`末次视觉HTTP503暂停和`04-48-12.202Z`目录三次503未开始答题的失败报告均保留。
- H5PStudio实际公开筛选表单GET入口：[Question Set / CC BY](https://h5pstudio.ecampusontario.ca/catalogue?h5ptype=Question%20Set&license=1)、[Question Set / CC BY-NC-SA](https://h5pstudio.ecampusontario.ca/catalogue?h5ptype=Question%20Set&license=5)，`site-audit-2026-10-03T04-51-25.985Z`两页并行只读取得实际链接；不是答题证据。许可1过滤结果也含其他衍生许可，不仅凭查询参数认定内容授权。
- [Data Visualization Quiz 97836](https://h5pstudio.ecampusontario.ca/content/97836)明确Login Required/Ontario Commons授权要求，排除，不登录/绕过；审查器阻断页不再分类嵌入元数据。旧`04-50-09.152Z`类型计数不作活动可访问证据。[Unit2 Podcast Quiz 97678](https://h5pstudio.ecampusontario.ca/content/97678)只有五单选无题图，非合格混合；音频也不作已支持。后续仅审查实际公开目录活动链接，外部模型0。

## 2026-10-03 12:42 公共Canvas末题与新的只读候选

- [Wordwall科学五题](https://wordwall.net/resource/114600206/general-science-quiz)、与[H5P图片多选](https://h5p.org/h5p/embed/1249570)并行、Gemini3.8Flash：`04-27-21.465Z`五题正确但末题淡出中/统计4/5暂停，图片4/4；`04-33-14.358Z`已真正显示GAME COMPLETE/5/5（最终PNG已查），两次独立识别completed，程序继续等待已消失控件而读到过渡画面暂停，仍4/5，整体不能记通过。修复等待后新场正在运行，最终结果以WORK_CHECKPOINT首节为准，不改原失败报告。
- [iSpring官方教育演示](https://www.ispringsolutions.com/ispring-quizmaker/demos)：`site-audit-2026-10-03T04-28-59.502Z`初次仍加载，后续`04-30-23.211Z`宽视口/模拟焦点45秒加载就绪；不能仅凭初次加载图认定不可用。`04-34-37.450Z`自己的隐藏浏览器两页并行、原生点击已审查开始入口，仅进入第一题：[Solar System](https://cdn4.ispringsolutions.com/demos/ispring-quizmaker/solar-system/index.html?embed=1)首先排序，当前不支持；[Geometry](https://cdn4.ispringsolutions.com/demos/ispring-quizmaker/geometry-test/index.html?embed=1)判断，但没有原生/ARIA单选语义，仅空名按钮，尚未证明完整三题型。未填写/提交/输入资料，外部模型0。
- `site-audit-2026-10-03T04-40-24.449Z`自己的隐藏浏览器四页并行只读：[SurveyJS普通限时](https://surveyjs.io/form-library/examples/make-quiz-javascript/reactjs)及[立即反馈限时](https://surveyjs.io/form-library/examples/create-quiz-with-immediate-results/reactjs)实际入口显示每题10秒/整场25秒、姓名框及Start Quiz；[Scored Quiz](https://surveyjs.io/form-library/examples/create-a-scored-quiz/reactjs)公开Star Wars入口无姓名框，有Start，后续可只开始审查；[Hot Potatoes官方四题型示例](https://hotpot.uvic.ca/wintutor6/jquiz2.htm)当前第一题单选按钮，含单选/短答/混合短答/多选的官方示例，但尚无题目图片证据。均未答题，不把官方文档或隐藏内容当模型答案。
- `site-audit-2026-10-03T03-54-37.529Z`：UVic实际独立单选/多选/算术，不能拼接；H5P目录104207候选后续`03-55-38.520Z`与`04-02-18.962Z`分类：[1322773](https://h5p.org/node/1322773)填空+拖词；[1064413](https://h5p.org/node/1064413)填空+判断；[5921](https://h5p.org/node/5921)四多选+填空+两个未支持；[10497](https://h5p.org/node/10497)/[10598](https://h5p.org/node/10598)填空+拖词/标词；[5958](https://h5p.org/node/5958)/[5959](https://h5p.org/node/5959)独立单选；[439543](https://h5p.org/node/439543)两判断。以上均无题图或缺类型/有未支持，仍无严格单一混合闭环。
- `site-audit-2026-10-03T04-10-20.943Z`：[QSM sample](https://demo.quizandsurveymaster.com/qsm_quiz/qsm-sample-quiz/)有10分钟倒计时/开始入口，但样例包含验证码与额外不支持类型，未解验证码或填写个人资料；[Avenue教程](https://kb.avenue.ca/article/adding-an-h5p-question-set-activity)仍指向已知官方Question Set，无新合格活动。均只读、外部模型0，原报告保留。

## 2026-10-03 11:52 公共Canvas实际执行与候选补查

- [Wordwall General Science](https://wordwall.net/resource/114600206/general-science-quiz)：自己的隐藏Chrome、与[H5P图片多选](https://h5p.org/h5p/embed/1249570)并行、仅Gemini3.8Flash。`background-2026-10-03T03-44-06.997Z/`进入Canvas但把0:00误判倒计时，零点击暂停；修正后`03-47-08.592Z/`首题实际正确、一原生坐标点击并VERIFY，1/5暂停，原因含新鲜度拒绝及不可靠坐标。两份图片站均4/4。原截图/模型读数保存，不记录为公共Canvas完整通过。
- 公共[第二个Science quiz](https://wordwall.net/resource/50307/science/science-quiz)与上述站的实际源码几何探针`canvas-surface-probe-2026-10-03T03-40-02.666Z/`确认873×506大Canvas。启动前置关闭视口连接导致缩回小图的测试器缺陷已修正；探针仅开始游戏，无模型/答案，不能替代求解验收。
- `site-audit-2026-10-03T03-48-04.990Z/`：并行只读[McMaster创建示例](https://ecampusontario.pressbooks.pub/mcmasterpb/chapter/getting-started-with-h5p-studio/)和[Fanshawe类型示例](https://ecampusontario.pressbooks.pub/oerdevelopmentguide/chapter/h5p-content-types-examples/)，实际CloudFront403，未绕过；[UBC研讨页](https://blogs.ubc.ca/h5psymposium/resources/studio-session-getting-started-w-h5p/)中的QuestionSet仍为已查151，另150是独立多选且无图，不能拼接为合格混合活动。无新增严格混合逐题通过证据。

## 2026-10-03 08:54 继续候选审查

08:58 新证据：`site-audit-2026-10-03T00-55-43.180Z/`，自己1280×900视口/模拟页面焦点（不改变桌面焦点）、两Wordwall并行只读等待45秒，两PNG已实际查看。各873×506 Canvas正常显示完整题目预览及START，runtime_errors=[]；此前小视口的缩略加载状态不能用来断言游戏不可用。视口和模拟焦点单独贡献未验证。只见统计/广告失败，未跨越访问控制；没有点击开始/答题，下一步可在自有隐藏浏览器进入游戏，再验证允许Gemini的真正视觉闭环及实际游戏终点，不能先记通过。

- [Wordwall General Science](https://wordwall.net/resource/114600206/general-science-quiz) 与 [Science quiz](https://wordwall.net/resource/50307/science/science-quiz)：自己隐藏浏览器两页并行，加载后额外45秒仍为187×122的加载Canvas，已查看截图；`site-audit-2026-10-03T00-46-34.466Z/`终止0，仅只读审查。资源计时保存，不根据跨域transfer或资源存在推断完整可用，未开始、登录或填写排行榜；仍不算公共Canvas验收。
- [LMU arabisch.digital Question Set](https://www.arabisch-digital.gwi.uni-muenchen.de/index.php/h5p/questionset/)：`site-audit-2026-10-03T00-51-56.952Z/`实际content559四题为MarkTheWords/DragText/Blanks/DragQuestion，有图、无单选多选；content558四题为MultiMediaChoice 0.3，当前不支持。网页允许公开OER使用，但两组都不能作为完整三支持题型的活动。
- [UTS Activity 类型说明](https://educationexpress.uts.edu.au/collections/creating-interactivity-with-h5p/resources/h5p-content-types-activity/)：同报告实际页面为说明文本，当前未发现iframe/H5P活动；不能仅凭文章列出“Question Set”就作为可执行活动。

以上全为并行只读、外部模型调用0，无新增混合逐题或公共Canvas通过证据；网址与失败原因保留供后续选择网站。

## 2026-10-03 08:29 进一步公开清单审查

独立隐藏浏览器并行只读，不调用模型、不答题、不登录，报告全部保留：

| 实际入口 | 审查证据与结论 |
| --- | --- |
| [Rustkin 公开内容目录](https://h5p.org/user/305916/mycontent?order=title&sort=asc) | 实际发现各测验链接，只读收集相关 href。`site-audit-2026-10-03T00-16-05.227Z/`；不是题组完成证据。 |
| [OSU Question Set 示例](https://distanceeducation.ehe.osu.edu/ehe-supported-tools/h5p-content-creation-tool/quiz-question-set-h5p-content-type/) / [实际嵌入615](https://h5p.org/h5p/embed/615) | 三题：单选、多选、拖放、无填空，仍不合格；同上报告。 |
| [UFL 示例](https://ufl.pb.unizin.org/msmpstyleguide/chapter/h5p-examples-2/) | CloudFront 403，未绕过；同上报告。 |
| [Paleolithic mixed quiz /757544](https://h5p.org/node/757544) | `00-18-57.938Z`：六题，三单选（含判断）、一填空、两未支持（拖词/标词），有图片、无多选，不能完整执行。 |
| [16th Century Quiz /692324](https://h5p.org/node/692324) | 同上报告：八题全为单选，有图片，无多选/填空。 |
| [Hominids quiz /750341](https://h5p.org/node/750341)、[Metal Ages Quiz /763451](https://h5p.org/node/763451) | 两个独立填空活动，非混合单场。早期审查器误把 standalone Blanks 内部 questions 字段当 QuestionSet，已改后续分类，但不改原报告。 |
| [16th century quiz /692313](https://h5p.org/node/692313)、[Historical sources quiz /754024](https://h5p.org/node/754024)、[Time quiz /750489](https://h5p.org/node/750489)、[Time quiz /750511](https://h5p.org/node/750511) | `00-27-55.187Z`：独立单选/判断或 SingleChoiceSet，后三者中前两个有题目图片；均缺同场多选/填空。SingleChoiceSet 审查只证明类型，不将旧 report.question_count=1 当完整内部题数。 |
| [Archaeology Quiz /754013](https://h5p.org/node/754013)、[Neolithic quiz /762348](https://h5p.org/node/762348)、[Queen Quiz /683219](https://h5p.org/node/683219) | 同上报告：均为 DragText，当前不支持，不记通过。 |
| [Wordwall General Science 5题候选](https://wordwall.net/resource/114600206/general-science-quiz)、[Wordwall Science 候选](https://wordwall.net/resource/50307/science/science-quiz) | `00-28-41.876Z`：两页实际各含一个 Canvas；只读截图仍为加载状态，尚未开始或识别真实题目。周围 radio/checkbox 属于游戏设置，不应当题目。可继续检查必要游戏资源是否加载后再做公共视觉验收；没有登录或提交排行榜姓名。 |

审查器现在按 QuestionSet 与独立库区分、去重同一 H5P 内容，并另记录 contains_question_image，避免只见背景图就当图片题。上表仍没有新增完整混合逐题通过证据。

## 2026-10-03 08:10 新授权入口后的另一组真实策略

仍是自己的隐藏浏览器、同次两网站并行、`gemini-3.8-flash-high`，补齐浏览器/策略组合：

| 浏览器 / 策略 | 报告 | 实际结果 |
| --- | --- | --- |
| Chrome / 监督自动 | `background-2026-10-03T00-08-24.606Z/` | Quiz of the Day 十题、两批、一次提交，COMPLETE 10/10、单站 passed=true；并行 H5P 图片多选三次503后 PAUSED、0作答，整体退出1。 |
| Edge / 无人值守 | `background-2026-10-03T00-08-26.092Z/` | 整页同样 COMPLETE 10/10、两批/一次提交、单站通过；图片多选三次503暂停，整体退出1。 |

两个句柄40103/48137均终止、报告 errors=[]，模型服务故障仍在 snapshot.notice 与 failed 站点判定中保留。结合07:57两份报告，真实整页两浏览器×两策略四组合已有证据；不能因局部通过而将失败报告总体改为通过。严格单一混合逐题活动、公共 Canvas、计时及余下交互验收继续。

## 2026-10-03 07:57 真实整页修复通过

独立隐藏浏览器、两个真实网站并行，使用用户允许的 CPA `gemini-3.8-flash-high`：

| 浏览器 / 策略 | 报告 | 实际结果 |
| --- | --- | --- |
| Chrome / 无人值守 | `background-2026-10-02T23-56-44.739Z/` | [Quiz of the Day](https://quizofthedayuk.co.uk/) 十题、两批/2 调用、一次整场提交、COMPLETE、网站及总结 8/10；[H5P Image Choice](https://h5p.org/h5p/embed/1249570) COMPLETE 4/4、1 调用。 |
| Edge / 监督自动 | `background-2026-10-02T23-57-06.918Z/` | 同样十题/两批/一次提交、COMPLETE 8/10；图片多选 COMPLETE 4/4、1 调用。 |

两份报告 passed=true、errors=[]、最后网站 visibility=hidden，句柄 52553/65812 均退出 0。真实成绩图及 Edge 的完整两卡任务面板图已查看：各卡模型、策略、次数及最终分数正常。这证明这两个组合的真实整页闭环，不证明模型满分、混合逐题单场或公共 Canvas。较早 8/10 但 VV 未验证终点的失败报告原样保留。

## 2026-10-03 07:52 新整页候选及真实模型结果

| 实际入口 | 当前证据与结论 |
| --- | --- |
| [Quiz of the Day](https://quizofthedayuk.co.uk/) | 公开整页十题，命名单选组，各自 question-card 与 question-title，无需登录。真实 Gemini 3.8 Flash、两网站并行报告 `background-2026-10-02T23-48-05.070Z/`：识别并填写十题、两批/2 调用，网站实际显示 8/10；VV 未验证成绩页而 PAUSED，不能记整场通过。下一步处理成绩后仍展示题卡的结果识别。 |
| [H5P Image Choice](https://h5p.org/h5p/embed/1249570) | 与上述整页同次并行，COMPLETE、4/4、1 次调用；仅证明此独立图片多选活动，不代替完整混合单场。 |
| [Quizmoz General Test](https://www.quizmoz.com/tests/Miscellaneous-Tests/g/General-Test.asp) | 只读审查十个原生单选组；旧表格布局多个组共享 TBODY，附评论表单及广告。尚未可靠分离逐题，不调用模型或提交评论，不记通过。 |
| [UVic H5P quiz 页面](https://uviclibraries.github.io/h5p/quiz.html) | 当前为教程说明，未发现可完成的真实题组。 |
| [Thüringen H5P Question Set](https://h5p.test.schulcloud-thueringen.de/question-set) | 实际三题：单选、多选、拖放及图片；没有填空，拖放未支持，不符合完整三题型单场。 |

清单证据 `site-audit-2026-10-02T23-39-33.073Z/` 与 `23-46-30.756Z/`，自己的隐藏浏览器并行审查、无模型/答题/登录。跟进嵌入仅限相关 H5P 或 embed，不继续无关广告框架。真实整页较早失败报告 `background-2026-10-02T23-41-49.230Z/`、`23-42-44.832Z/`、`23-45-35.561Z/` 均保留，分别记录测试授权不足、错误合并题组、修复后安全歧义暂停。网站成绩不等于 VV 已通过终点验收。

## 2026-10-03 07:00 公开活动题型清单复核

`scripts/audit-public-quiz-sites.mjs` 在独立隐藏浏览器中并行只读审查。没有题目求解、模型调用、登录或绕过安全验证。H5P 配置仅用于审查题型数量/图片/不支持库，不向 Solver 提供隐藏答案；auto 选择题的单选/多选按 H5P 实际类型逻辑核对。清单审查不等于完成答题。

| 实际入口 | 当前实际内容与结论 |
| --- | --- |
| [H5P Language practice /8777](https://h5p.org/h5p/embed/8777) | 等实际导航完成后确认 10 题：9 单选+1填空，有图片，无多选。`site-audit-2026-10-02T23-03-52.384Z/`；不能满足严格混合单场。早先等待不足的 about:blank 不是该站缺失证据。 |
| [UBC symposium question set id151](https://h5p.open.ubc.ca/wp-admin/admin-ajax.php?action=h5p_embed&id=151) | 两题：1单选+1多选，无填空/图片；同上报告。 |
| [UBC Question Set 示例](https://h5p.open.ubc.ca/h5p-examples/quiz-question-set/) | 3题：1单选+1多选+1拖放，有图片，没有填空；`site-audit-2026-10-02T23-02-04.406Z/`。拖放不在当前三题型范围。 |
| [MacEwan Question Set](https://openbooks.macewan.ca/using-h5p-objects-in-online-courses/chapter/question-set/) | 10题：2单选+1多选+1填空+6未支持（拖词、两拖放、标词、多媒体选择、Essay）；有图片。虽包含三题型但不能完成整场，仍不合格。 |
| [Testmoz demo /1](https://testmoz.com/1) | 显示 Student Login 和名字/喜好颜色入口，没有可作答题目；`site-audit-2026-10-02T22-55-57.059Z/`。没有加入学生测试或输入身份，不记整页通过。 |
| [Penn State 示例](https://h5p.psu.edu/interactive-stimului/respond-to-questions-of-various-types/) 的 [实际嵌入2027](https://behrend-elearn.psu.edu/interactive/h5p/embed/2027) | 实际嵌入仍停在 Cloudflare 安全验证，未访问题组；同上报告。没有绕过防护。 |

全部报告和页面截图保留在 `.browser-regression-runtime/`。这些候选均没有证明完整单一混合逐题活动或真实整页验收；继续筛选，不把独立活动拼成一场。模型授权优先 Gemini 3.8 Flash，缺少/不可用才用用户允许的 Gemini 3.7 Flash/3.1 Pro，其他真实模型不使用。

## 2026-10-03 人工操作保护后的并行回归（最新）

独立隐藏 Chrome、授权 CPA `gemini-3.8-flash-high`，三个真实网站同时启动，用户鼠标及现有浏览器没有参与。报告 `background-2026-10-02T18-46-25.110Z/`，记录器无错误、各网站截图保留：

| 实际网址 | 最新结果 |
| --- | --- |
| `https://h5p.org/h5p/embed/1512` | COMPLETE、3/3、3 次调用，0 猜答/重试/失败；新保护没有把程序化选择误判为人工操作。 |
| `https://h5p.org/h5p/embed/1039075` | COMPLETE、5/5、1 次调用，0 猜答/重试/失败。 |
| `https://www.w3schools.com/quiztest/quiztest.php?qtest=C` | Provider 连续三次不可用后 PAUSED，0 题作答；当前运行未通过，保留较早 25 题完成的历史证据。 |

人工暂停本身在 Chrome/Edge 多个本机网站并行测试中，使用真实浏览器鼠标/键盘事件通过主页面、跨源 iframe 和监督填空三种场景；恢复后均 COMPLETE。报告 `provider-mv3-2026-10-02T18-45-33.486Z/`，外部模型调用 0。该本机功能验证不能代替严格混合题组、真实整页或 Canvas 整场验收。

## 2026-10-03 后台多网站并行复测

所有运行使用全新独立隐藏配置和独立扩展构建，没有导航、重载、关闭或激活用户现有浏览器。当前 CPA 目录确认存在 `gemini-3.8-flash-high`，本轮只调用该授权模型。网站标题、最终文字、会话、计数和截图保留在项目 `.browser-regression-runtime/` 对应报告中；没有删除文件。OS 通知在隐藏测试中转为记录，不能把通知请求当作真实系统通知送达证据。

| 实际网址 | 当前结果与证据 |
| --- | --- |
| `https://www.w3schools.com/quiztest/quiztest.php?qtest=C` | Chrome 隐藏四网站并行：COMPLETE、25 题、26 次调用、0 猜答/题目重试/失败；网站最终 24/25、96%。报告 `background-2026-10-02T17-55-16.099Z/`。前一次已到最终成绩却暂停的问题由结果比例/百分比识别及 ADVANCE 完成分支修复。 |
| `https://h5p.org/h5p/embed/1512` | 当前 Edge：COMPLETE、3/3、3 调用；报告 `background-2026-10-02T18-19-26.562Z/`。选中动作改为先清除未选项，再最后点击答案，避免自动跳题后继续操作旧控件；另识别延迟成绩页。升级 SDK 后 Chrome 也达到 COMPLETE、3/3，但该次截图超时，报告中保留失败。 |
| `https://h5p.org/h5p/embed/1039075` | 当前 Edge：COMPLETE、5/5、1 调用；同上报告。Chrome 并行复测也完成 5/5。 |
| `https://h5p.org/h5p/embed/1249570` | Chrome 四网站并行曾 COMPLETE、4/4、2 调用；升级 SDK 后 Chrome 和 Edge 图片活动遇 CPA 503，各计入三次请求后 PAUSED，0 猜答。当前版本最新图片通过证据仍需补齐，不能忽略服务故障宣布新版本全通过。 |

这些仍是独立活动，**不满足一个真实活动同时包含文字、图片及三种题型**的严格标准。整页与 Canvas 的真实验收也尚未完成。完整逐项清单见 [版本推进与证据](RELEASE_PROGRESS.md)。

## 2026-09-30 可见浏览器试跑与人工交接

- 新候选 [H5P This/That, These/Those 逐题题组](https://h5p.org/node/8777) 是约 10 题的单一活动，包含文字、图片、单选和填空，但**不含同场多选**。因此即使整场完成也不能独自满足 `PROJECT_SPEC.md` 第 9 节的三题型单场标准。
- 在隔离可见 Chrome for Testing、CPA `gemini-3.7-flash-high` 上试跑；第 9 题出现网站 “Wrong!” 反馈，VV 在点击 “Try again” 之前重新观察已评分题目并进入 `FAILED`。实际作答 9/10，**未完成整场**。其后将已映射重试控件的执行顺序提前，定向本地测试通过；用户要求停止测试，尚无修复后的真实站点通过证据。
- 用户将通过 [可视化人工验收程序](manual-acceptance.md) 自行在可见网站标签启动 VV、观察过程并保存结果。程序的自动状态记录和人工成绩/截图应一同复核；人工自行答题不能记作 VV 自动闭环通过。此交接不改变前述三个独立活动的已通过记录，也不等于 1.0.0 已通过。

## 2026-09-29 恢复与公开网站筛选

- 在 Git 提交 `183007d` 的源码上执行 `pnpm install --frozen-lockfile` 和 `pnpm check`：类型检查、13 个测试文件共 71 项测试、正式构建均通过。此结果只证明当前本地测试和构建。
- 使用隐藏的隔离 Chrome for Testing 154.0.8037.57 检查下表网站。测试扩展只在隔离构建的 `dist/manifest.json` 中临时增加 `https://h5p.org/*` 权限，检查结束后重新正式构建恢复；正式清单始终是 `static/manifest.json`。下表先记录 VV 内容脚本的观察与筛选；随后完成的模型闭环另见下一节，不把单纯观察当作端到端通过。
- 用户完成 CPA 配置并授权仅使用指定模型后，经现有 CPA 隧道查询到 `gemini-3.8-flash-high`，本轮正式验收优先使用它。曾在单选题组用 `gemini-3.7-flash-high` 试跑一题，因 VV 未识别 H5P 选中类名而暂停；修复后下面的通过结果均来自 `gemini-3.8-flash-high`。未调用其他模型。

### 2026-09-29 真实模型闭环复测

环境：隐藏的全新隔离 Chrome for Testing 154 与 Microsoft Edge 154 配置、本地构建、CPA `gemini-3.8-flash-high`，每场调用上限 60。测试专用站点和 CPA 权限仅临时加入被忽略的 `dist/manifest.json`；没有写入正式扩展清单或用户默认浏览器配置。网站文本和必要图片经用户授权发送给 CPA 模型。每场均检查 VV `COMPLETE` 和 H5P 结果页。

| 实际网站活动 | 覆盖内容 | Chrome / Edge 的 VV 结果 | Chrome / Edge 网站结果 |
| --- | --- | --- | --- |
| [H5P Single Choice Set](https://h5p.org/h5p/embed/1512) | 文字单选，3 道逐题自动翻页，最后一页为结果页 | 均 `COMPLETE`，3/3 作答，各 3 次模型调用，0 猜答、重试、失败 | 均 3/3 |
| [H5P Image Choice](https://h5p.org/h5p/embed/1249570) | 图片选项多选，7 个图片选项 | 均 `COMPLETE`，1/1 题作答，各 1 次模型调用，0 猜答、重试、失败 | 均 4/4 |
| [H5P Passive Voice Past Negative](https://h5p.org/h5p/embed/1039075) | 文字填空，5 个空格 | 均 `COMPLETE`，1/1 题作答，各 1 次模型调用，0 猜答、重试、失败 | 均 5/5 |

真实网站暴露了 H5P 单选控件只用 `h5p-sc-selected` 类标记答案、且没有显式“下一题”按钮并延迟自动翻页。VV 已增加这类控件的选中判定及自动翻页等待；72 项本地测试、类型检查和构建通过。第一次重测复用了旧隔离浏览器配置，后台脚本仍跑旧代码而暂停；换全新隔离配置后，最新代码完成整场。

上表是**同一真实网站的三个独立活动**，覆盖三种题型与图片，并非一个活动内混合三种题型。按 `PROJECT_SPEC.md` 第 9 节更严格的“一个真实逐题网站完成文字、图片及三种题型的整场闭环”标准，单一混合活动仍待找到并实测；本节不能作为该项已经通过的证据。Edge 验收使用独立配置，尚未在用户默认配置中复测安装界面和权限流程。

| 稳定入口 | 本轮实际检查结果 | 下一步 |
| --- | --- | --- |
| [H5P Single Choice Set](https://h5p.org/h5p/embed/1512) | 公开题组首题显示 Goji berries，页面标示第 1/4 页；VV 观察到 `single_choice`、3 个文字选项。本轮实际完成 3 道题及结果页，详见上表。 | 已完成独立活动闭环。 |
| [H5P Image Choice](https://h5p.org/h5p/embed/1249570) | VV 观察到 `multiple_choice`、7 个图片选项及 7 个题目媒体引用。本轮模型复测网站 4/4。 | 已完成独立活动闭环。 |
| [H5P Passive Voice Past Negative](https://h5p.org/h5p/embed/1039075) | VV 观察到 `fill_blank`、5 个输入空格。本轮模型复测网站 5/5。 | 已完成独立活动闭环。 |
| [UBC H5P Question Set](https://h5p.open.ubc.ca/h5p-examples/quiz-question-set/) | 页面可加载；该实际题组是两道 Multiple Choice 加一道 Drag and Drop，后者不在 VV 1.0.0 范围内。 | 不作为三题型整场候选。 |
| [MacEwan H5P Question Set](https://openbooks.macewan.ca/using-h5p-objects-in-online-courses/chapter/question-set/) | 页面可加载；实际 10 题虽含填空、图片选择和选择题，也含拖拽、Essay、音频等 1.0.0 未支持内容。 | 不作为 1.0.0 整场候选。 |
| [arabisch.digital Question Set](https://www.arabisch-digital.gwi.uni-muenchen.de/index.php/h5p/questionset/) | 页面可加载；两个题组分别为图片选择四题，以及标词、拖词、填空、拖放四题。 | 不作为三题型整场候选。 |
| [H5P World Cup 2018 Question Set](https://h5p.org/node/265337) | 页面可加载；实际 5 题含选择、判断、标词、拖词和填空。 | 含 1.0.0 未支持题型，不作为整场候选。 |
| [H5P Berries quiz](https://h5p.org/h5p/embed/1378499) | 本轮在隔离 Chrome 实际加载；其首屏为带章节导航的 Interactive Book，VV 观察结果是 `multi_question_page`，并非单题逐页 Question Set。 | 不作为 1.0.0 逐题闭环候选。 |
| [Toronto Metropolitan Pressbooks Sample Quiz Question Set](https://pressbooks.library.torontomu.ca/h5pbook/chapter/quiz-question-set/) | 本轮在隔离 Chrome 实际加载；样例 iframe 为 `about:blank`，未出现可作答内容。 | 无法据此验收。 |
| [Penn State H5P Question Set 示例](https://h5p.psu.edu/interactive-stimului/respond-to-questions-of-various-types/) | 本轮查到实际嵌入地址 `https://behrend-elearn.psu.edu/interactive/h5p/embed/2027`；隔离浏览器访问时停在 Cloudflare 安全验证页。 | 遵守 1.0.0 边界，不绕过网站防护，不作为验收。 |

H5P.org 同一域名的三个独立活动已覆盖文字、图片、单选、多选和填空的模型闭环。它们不是同一场混合题型测验；按 `PROJECT_SPEC.md` 第 9 节的严格整场标准，仍需寻找并跑通一个包含全部要求的真实逐题题组。

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
# 2026-10-03 17:37 评分过渡修复增量

公开[八题文字三型活动2360](https://h5pstudio.ecampusontario.ca/content/2360)没有题目图片。`background-2026-10-03T09-23-14.394Z`原始记录显示同题1/1的可访问公告与动画中旧0/1同时出现，错误重试导致已禁用填空动作失败；退出1保留。零模型`h5p-grading-probe-2026-10-03T09-31-15.579Z`复现，`09-33-33.292Z`修复后第一次状态correct、最后correct、退出0。测试只用此前真实模型公开观测到的候选3/10，不读隐藏解答。

当前题评分公告优先于旧动画；Retry动作成功且旧评分清空后再求解，失败/unknown不继续请求模型。完整258项与类型检查通过。优先Gemini3.8Flash新场`background-2026-10-03T09-34-02.094Z`运行中，结果待原句柄72868终止复核。八题文字与另一个图片活动不得拼接成严格图文同場。用户浏览器/CMD/记录器保持未操作，无删除。

## 2026-10-05 03:50 独立入口及图片收尾复验

主线EasyCPA独立连接、图片成绩页终点修复与实际Chrome/Edge结果见 `MAINLINE_CHECKPOINT.md` 的03:50补充。公开八题文字活动Edge无人值守完整9/9，缺题图，不计为严格图文三型同场；新只读候选名单见 `PUBLIC_QUIZ_CANDIDATES_20261005.md`，所有网址与排除原因保留。


## 2026-10-05 04:40 主线补验与暂停

2360在Edge监督模式完整8题9/9，14调用/5次按反馈重试；报告background-2026-10-04T20-27-12.357Z。60107有图片和单选/填空，缺多选；两次4/5暂停报告20-27-12.357Z/20-35-02.473Z均不计通过。重试候选button_candidate修复仅代码检查已通过，完整真实复验待恢复。Canvas四组合12闭环见CANVAS_ACCEPTANCE_20261005.md，不替代公共同场。按用户额度不足要求暂停，最新恢复顺序见MAINLINE_CHECKPOINT.md最后04:40节。
