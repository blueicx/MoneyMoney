# 股票区按需挂载与图表格式化性能记录

## 范围和未完成项

本批只试点股票行情区的DOM挂载边界，不把四市场全部页面改成新框架。整页冷加载改善20%尚不能认定；局部CPU基准不能换算成整页改善。现有主题、接口、深链、数据来源和AI跑单配置保持原样。

## 已实现

- 构建时通过现有jsdom的原始节点位置，将`stocks-market`区块原样包进惰性template；不重新序列化内部HTML，不执行构建用脚本。缺失或重复目标立即使构建失败。
- 股票行情/雷达首次进入时同步挂载，其他市场及内部人、事件等工作区不提前挂载图表。首次挂载后保留同一个画布和控件，离开仅隐藏，返回不重复创建ID。
- 挂载时恢复当前周期高亮、形态和双图控制，折叠监听器重复初始化不会叠加。新增测试实际捕获了“深链日线仍高亮5分”的失败，再完成修复。
- `formatChartTime`复用本地格式器；日内时间按交易所时区缓存，最多8项；日线仍用ISO日期。夏令时、切换时区、非法时间及非法时区行为有测试。
- 本地测速可选`MONEYMONEY_BENCHMARK_PROFILE=1`，记录CPU自耗时/包含耗时及布局、样式、脚本指标；默认不开启，不在生产常驻。摘要丢弃URL的主机、查询参数，不保存页面内容或凭据。

## 已核验的局部证据

同一批2000个时间标签、真实修改前后函数、5轮取中位数：79.74ms降到2.93ms，逐项输出相同。这是Node环境函数级基准，不是浏览器整页或真实行情速度承诺。

源HTML实时元素1231个，构建后未打开股票区时1082个；股票画布在惰性template内，不在实时DOM。这个数值不含页面运行后额外创建的节点，不等同内存改善比例。

初步CPU采样中冷启动布局约0.90秒、脚本约0.05秒；另一轮实际行情请求耗时约6.5秒，说明必须分开看来源等待、布局及计算，不据单一总时长猜原因。

## 已撤回的试验

- 认证和上下文完成后才显示整页内容：未得到稳定收益，已撤回相关HTML、CSS和引导逻辑，不留加载遮罩。
- 提前异步运行认证模块：完整冷热对照没有显示改善，已撤回；私有数据仍沿用既有认证门控。
- 门控试验的一组手机样本出现`ERR_NO_BUFFER_SPACE`导致启动脚本下载失败，该轮不当成通过证据。只检查了资源状态，未重启用户浏览器、修改网络或关闭用户连接。

## 本地复验

```powershell
node --test tests/stock-workspace-mount.test.cjs tests/chart-time-format-performance.test.cjs tests/benchmark-profile.test.cjs
npm run build
npm run smoke:browser
npm run smoke:chart-path
```

CPU诊断仅在隔离环境运行：

```powershell
$env:MONEYMONEY_BENCHMARK_PROFILE='1'
$env:MONEYMONEY_BENCHMARK_VIEWPORT='desktop'
$env:MONEYMONEY_BENCHMARK_RUNS='1'
npm run smoke:chart-path
Remove-Item Env:MONEYMONEY_BENCHMARK_PROFILE
Remove-Item Env:MONEYMONEY_BENCHMARK_VIEWPORT
Remove-Item Env:MONEYMONEY_BENCHMARK_RUNS
```

诊断启用时会增加采样开销，结果不得混入默认性能对照。所有测试使用隔离业务目录，不向生产发测试单、通知或真实模型请求。用户原有未跟踪`data/research.db`保持不提交，已核对原Hash。

## 最终本地验收

- 完整测试1474项、297文件，退出0；构建、Web、安全扫描788文件及差异检查通过。
- Chromium原有四市场、三主题矩阵通过，额外验证驾驶舱不挂载股票画布、首次进入只有一个画布、离开/返回画布对象和周期保留；源HTML不变，宏观/事件/内部人原节点仍可用。
- 认证冒烟并发执行时共享静默UI一次等待超时，停止并发后独立复跑通过；失败不当通过。行动/研究、实时图表、合约串行冒烟通过。实时图表推流为隔离fixture验收，隐藏页绘制0、倒计时重绘0，不宣称是真实逐笔行情。
- 最终无CPU采样测速：桌面1440/手机390，每种冷热3次，CPU4倍、80ms、750KB/s。热加载脚本传输0字节，请求去重及认证后同上下文行情预取检查通过。

| 产物 | 桌面冷页面/图表 ms | 桌面热页面/图表 ms | 手机冷页面/图表 ms | 手机热页面/图表 ms |
|---|---:|---:|---:|---:|
| 3c5c674本轮固定基线 | 2169/3049 | 425/704 | 1926/2878 | 580/868 |
| 股票挂载试点+格式器复用 | 2432/2902 | 542/759 | 1935/2922 | 488/793 |

这组数据不支持整页改善20%，也不支持所有路径都更快；用户此前已允许先发布通过验证的功能，性能目标继续单列。日志在系统临时目录`mm-stock-mount-frozen-tests.log`、`mm-stock-mount-browser-final.log`、`mm-mount-auth-isolated.log`、`mm-mount-final-smoke-*.log`和`mm-boot-layout-before.log`。

## 生产发布

代码`df7fb222528dedca244f90fcc1df9e0e17d4bd90`已提交推送并核对远端引用，提交后重新构建和Web冒烟通过。发布标签`df7fb22-20261016-stock-mount`，仅操作`moneymoney.service`并切换dist，不替换数据库或配置。

- 归档Hash：`86be2529f185fd8fe324794f79f1e93a98d9c43d7212df32444f1561fa8f776e`。
- 远端index Hash：`b24814a831d17c06513d9bf43f745a96148e05503f8224cba95a7f2e0591e50a`；manifest Hash：`bf607688aae38b36235a274f462e32da0095dd77ee741f73b07841dc39a0ce7c`，与本地一致。
- 公网实际下载核心资源Hash：`76afac5976a8df0dd298bac1755ae82b2e33c025064d5c966de965dd240206df`，与本地manifest一致。
- 备份：`/opt/moneymoney/backups/dist-pre-df7fb22-20261016-stock-mount`；回滚：`/opt/moneymoney/dist.rollback-df7fb22-20261016-stock-mount`。服务active，根盘约17GiB可用。
- 正式域名版本、健康和只读Chromium四市场/SNDK/移动布局/私有数据隔离验收通过。报告位于系统临时目录`moneymoney-canary-1792081171594/production-canary-report.json`。

补充对比同为构建产物的初始实时DOM：基线1217元素，试点1082元素，少135个；不以这个比例代替实际加载性能。源码HTML、未挂载template内容及运行后动态节点统计口径不同，不能混作同一计数。

本批发布完成不等于整页提速20%完成。按用户批准路线，后续再依据股票试点边界逐区扩展，不直接把全部工作区改成惰性DOM。
