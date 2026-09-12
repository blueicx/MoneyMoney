# MoneyMoney 交接文档 -- 2026-09-13 工作区空白修复

## 1. 用户反馈

- 选择股票、机构持仓、内部人交易、分析师共识等左侧功能后，右侧标的库会更新，但中心内容区为空。

## 2. 根因

- `#stocks-tab` 被缺失的 `</div>` 错误嵌套在 `#binance-tab` 内部。
- 币安 tab 在股票市场下处于隐藏状态，导致股票 tab 即使自身为 active 也被隐藏父节点裁掉。
- 工作区点击入口还可能留下 `workspace-hidden`/`scope-hidden` 类，因此入口只解除 `hidden` 不足以恢复面板尺寸。

## 3. 修复

- 补齐 `#binance-tab` 的外层闭合标签，使各市场 tab 成为 `#center-workspace` 的同级节点。
- `showTab()` 显式同步当前 tab 的 `active` 与 `hidden` 状态。
- `renderNavigationState()` 保证 active tab 不被 scoped rendering 留在隐藏状态。
- `openWorkspace()` 同时清理面板的 `workspace-hidden` 和 `scope-hidden` 类。
- 新增回归测试，检查 tab 同级结构和工作区切换可见性。

## 4. 验证

- `npm test`：270/270 通过。
- `npm run build`：通过。
- `npm run smoke:web`：通过。
- `npm run security:scan`：通过，322 个受跟踪文件检查完成。
- 本地无缓存浏览器：股票行情、机构持仓切换后 `#stocks-tab` 父节点为 `center-workspace`，中心面板宽度约 962px。
- 线上浏览器：机构持仓面板宽度约 962px、内容实际显示；内部人交易面板高度约 966px；分析师共识面板高度约 1197px。

## 5. 发布

- 代码提交：`e4587da fix: restore sibling market workspaces`
- 分支：`codex/stock-free-data-sources`
- 线上目录：`/opt/moneymoney/dist`
- 线上备份：`/opt/moneymoney/backups/dist-e4587da`
- 回滚目录：`/opt/moneymoney/dist.rollback-e4587da`
- 服务：`moneymoney.service`，状态 `active`
- 健康接口：`{"ok":true,"app":"MoneyMoney","status":"alive"}`
- 线上 `web/public/index.html` SHA-256：`17385773354141815a378f2c4872cbba8f91e0865d378a02e51c814ba47459fd`
- 本次只替换应用 `dist` 并重启服务，未修改 Nginx、TLS、VPN、密钥或 Telegram 配置。
