# 图表 DOM 重复初始化与布局读取优化

本批仅消除已复现的图表控件重建和无效布局读取，不表示整页冷加载提升20%已完成。沿用用户批准的“先发布已验收功能，继续优化性能”；不改变行情、主题、模拟账本或AI跑单配置。

## 证据与修复

本地隔离Chromium的CPU采样显示，冷加载存在明显原生布局开销，`renderChartPatternMarkers`即使没有点位仍会读取尺寸与矩形；`renderChartPatternControls`在股票挂载及启动收尾重复重建相同控件。

- 空/不可定位的形态集合清除旧标记后直接返回，布局读取次数从4次降为0。非空集合先读取几何，再替换旧节点，避免自己的DOM清空引发同步布局。
- 用形态目录签名控制控件重建；相同目录保留原输入、焦点和事件处理，仍同步新偏好；目录变化或容器被清空时正常重建。
- 点位标题、OHLC、触发条件、说明、可访问属性及点击展开不变。股票和虚拟币共用这段渲染，不引入跨市场数据。

`tests/chart-dom-performance.test.cjs`三项先失败（空集合4次测量、先写后读、控件节点变化），修复后通过。`scripts/browser-market-matrix.cjs`增加真实浏览器的节点/焦点保持断言。原有密集点位、边界限制、策略点击解释及股票按需挂载测试保持通过。

## 冷热复测

使用现有`node scripts/web-loading-benchmark.cjs`，桌面1440×900和手机390×844各3次冷/热，CPU4倍、网络80ms/750Kbps，真实应用Provider、隔离数据目录。没有开启CPU采样；开启采样的诊断数据不混入性能比较。热加载JS传输均为0，预取/请求去重断言通过。

| 版本 | 桌面冷页面/图表 ms | 桌面热页面/图表 ms | 手机冷页面/图表 ms | 手机热页面/图表 ms |
|---|---:|---:|---:|---:|
| 修改前df7fb22产物 | 2921/3591 | 713/934 | 2555/3295 | 684/899 |
| 本批修改 | 2861/3488 | 700/916 | 2609/3291 | 642/877 |

不能据此认定整页有稳定提速，更不能认定20%目标达成。不同批次的旧产物复测也有明显波动，不择优挑选基线。日志在系统临时目录`mm-chart-dom-before.log`、`mm-chart-dom-after.log`，诊断采样另见`mm-next-profile-before.log`。

后续应继续分离认证前资源/布局等待和图表模块下载的关键路径，而非将本次局部优化百分比外推成整页提速。

## 验收记录

- `npm test`：298个隔离测试文件，1477项通过，0失败。
- `npm run build`、`smoke:web`、`smoke:browser`、`smoke:auth`、`smoke:live-kline`、`smoke:contracts`、`smoke:actions`和`security:scan`通过；`git diff --check`通过。
- 浏览器矩阵覆盖四市场/三个主题与手机布局，新增控件对象及键盘焦点断言通过。实时图表冒烟为传输夹具测试，隐藏页绘制0、倒计时绘制0、倒计时读数DOM变化0；不冒充交易所实盘逐笔验收。
- 只涉及两个前端函数和测试/交接记录。差异自查确认不更改接口、Provider、数据库模式、AI模型路由、预算、范围、通知配置或订单逻辑；不用子agent。
- 本地未跟踪`data/research.db`保留，SHA256仍为`27fd475e523568daa4cdcabf3146917023335a62affe00429babd721b3b79fd1`。不纳入提交。
- 日志：系统临时目录`mm-chart-dom-tests.log`、`mm-chart-dom-build.log`、`mm-chart-dom-smoke-*.log`、`mm-chart-dom-security.log`。

## 发布核验

代码`14eeec0085938fd94c0cc69abd47137a8907df8c`已提交并推送，提交后重新构建和Web冒烟通过。只替换dist并操作`moneymoney.service`，未修改数据库、数据湖、配置或相邻服务。

- 发布标签：`14eeec0-20261016-chart-dom`。
- 归档SHA256：`3597291cda594c76cdacd6a2999e35e43ee6fcd1d013028f47dcc49bf300925e`。
- 远端index SHA256：`ca9efc5a7cfc7b85377fdd1bbc8fb9c51d39ae95e07282bed9356040db1246b8`；manifest SHA256：`3c0df64600ed61e647082fdda5b86197d6fc505ac7d71a0f1fb68ede7736f349`，均与本地一致。
- 正式域名实际下载核心脚本SHA256：`72bee3bdc78d0374a5bab197b5e7eb23838a66588d679a7705b43db32e42a2e1`；图表脚本SHA256：`dce8763641ce98642d4017ea4d9ab800cdb18ebf44bbccb099d25aa4026acbbd`，均与manifest一致。
- 备份：`/opt/moneymoney/backups/dist-pre-14eeec0-20261016-chart-dom`；回滚：`/opt/moneymoney/dist.rollback-14eeec0-20261016-chart-dom`。
- 服务active，内部健康检查与正式域名版本正确；正式域名只读Chromium四市场、SNDK、访客私有数据拒绝及移动布局检查通过，日志`mm-chart-dom-production.log`。检查未发送Telegram消息、未调用生产模型、未提交订单。
- 发布前根盘约17GiB可用；本地数据库Hash发布后仍未变。性能20%目标仍未完成，发布不改变这一结论。
