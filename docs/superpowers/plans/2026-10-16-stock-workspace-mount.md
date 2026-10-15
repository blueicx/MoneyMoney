# 股票图表工作区按需挂载实施计划

**目标：** 按用户批准的渐进路线，先让股票图表及其控件仅在股票行情/雷达工作区首次进入时挂载。保留宏观、事件及其他功能区的原DOM，不整体重写。

**架构：** 构建时将`stocks-market`区块保存在惰性template中，不序列化改写内部HTML。上下文恢复或切换到股票行情时同步移入原位置，再运行已有初始化；首次进入后保留节点与状态，离开时只隐藏，不卸载。

**边界：** 本试点不宣称全部工作区都已按需挂载，也不预先宣称整页冷加载提速20%。不改接口、行情来源、账户或AI配置，不使用子agent。

## 文件与步骤

- [ ] `scripts/stock-workspace-markup.cjs`：使用现有jsdom的节点原始位置提取区块；缺失或重复目标时报错，关闭构建用DOM。
- [ ] `tests/stock-workspace-mount.test.cjs`：先验证目标区块尚在实时DOM而失败；断言构建后仅股票图表惰性化，宏观/事件/内部人节点不丢失。
- [ ] `scripts/copy-web-assets.js`：写入index前应用转换，继续生成原有压缩产物。
- [ ] `src/web/public/modules/dashboard-runtime.js`：`mountStockChartWorkspace()`只在`stocks`及`stock-quotes/radar`触发，使用template.content移动原节点；重新绑定图表控件，防止重复折叠监听。
- [ ] 单测执行挂载两次，确认ID唯一，画布对象、周期、输入值保留；错误市场/功能不挂载。
- [ ] `scripts/browser-market-matrix.cjs`：默认驾驶舱没有实时股票画布；首次股票选择后存在，离开/返回画布对象与周期不重建；原有四市场和三主题矩阵继续通过。
- [ ] 运行`node --test tests/stock-workspace-mount.test.cjs tests/web-loading-recovery.test.cjs tests/chart-time-format-performance.test.cjs`，再运行完整`npm test`、构建、Web/认证/浏览器/实时图表/合约冒烟、安全扫描及`git diff --check`。
- [ ] 同环境每种桌面/手机冷热三次，使用真实来源，记录状态、原因和时间；失败样本不当成完成，保留20%目标的真实结论。
- [ ] 验收后提交、推送、备份并只部署`moneymoney.service`，核对正式域名、文件Hash、版本和回滚目录；保留数据库、数据湖及所有用户文件。

局部时间格式器复用单独记录，不把2000个标签的CPU耗时改善换算成整页加载改善。CPU采样仅在本地隔离测速开启，不常驻生产。

## 实际验收状态

构建/挂载/深链周期/重复监听/浏览器试点均已完成，完整1474项测试、四市场三主题、独立认证、行动研究、实时图表、合约、安全扫描及差异检查通过。最终冷热各三次已记录在交接文档，20%目标未认定通过；发布使用用户已批准的“先发布已验收功能”边界。VPS结果按交接文档最新发布记录核验。
