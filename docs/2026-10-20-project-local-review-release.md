# 研究项目本地自动复查

本批仅推进十二组平台路线中的项目证据复查，不代表全路线完成。

- 复用现有 SQLite，五分钟轮转最多五个私人项目；持久租约、游标、下次时间和结果计数。重启不立即扫描。
- 只读取明确关联的已保存记录；发现内容修订、证据过期或不可核验时生成复查待办。原结论和固定引用不覆盖。
- 相同引用已有同类待办时合并，避免任务进度和账户估值变化反复制造提醒。无变化不改项目版本或审计。
- 租约失效时回滚迟到写入；单项目或单市场索引失败保留原因状态并继续处理其他有效项目。
- 现有研究工作区提供管理员手动读取调度状态；不新增工作区、不轮询、不采集、不调用模型、不发消息、不创建订单。

## 本地验收

22项定向测试及TypeScript检查通过；365个隔离测试文件、1753项全量测试通过。构建、Web/认证/四市场/实时K线/专业研究/合约/研究深度七类冒烟及专用项目浏览器通过。浏览器涵盖三主题、桌面/手机、手动状态读取、明确引用、返回恢复、四市场隔离和访客拒绝。

日志：系统临时目录 mm-project-auto-review-full-tests.log、mm-project-auto-review-gates.log；专用浏览器产物 mm-assets-browser-4JZxN2。既有JSDOM警告仍保留，不宣称日志无警告。

安全扫描929个跟踪文件、差异检查通过。20%冷加载目标仍未达到；后续策略构建、AI质量实验及市场/组合/盲测/Telegram批次仍未完成。保留数据库、数据湖、scratch和既有跑单配置。

## 干净导出与生产验收

- 运行提交 `8fe882642d46206543551cac3613e75e475becfe`，已推送。干净导出 `moneymoney-review-clean-8fe8826-297f7d`，重新构建时固定完整提交；七类冒烟及项目专用浏览器再次通过。日志 mm-project-auto-review-clean-gates.log；浏览器产物 mm-assets-browser-NwfqNe。
- 正式域名 `https://bluetrade.bbroot.com`：有效TLS、完整版本、29个静态资源SHA256、immutable缓存和alive健康检查通过。
- 只读Chromium生产巡检通过股票、期权、虚拟币、预测市场及SNDK。私人项目列表及复查状态在未登录时均为401；未向生产创建项目、采集或模型实验，未发送Telegram消息。
- 归档 SHA256 `f5f5240df1f4788e1d18b0e4c03dc943ab7be00ab4953de6c656e5ba2f56b721`。
- server.js SHA256 `42e49485273b9f14377724affaa393508d3127bef7ab6db12cd88164e5384bff`；index.html SHA256 `4e001b41b25da01810de7d8a85eb0c921f5e3efc6f3b10b238589c3c402f8ef5`，与远端一致。
- 备份 `/opt/moneymoney/backups/dist-pre-8fe8826-20261020-local-review`；回滚 `/opt/moneymoney/dist.rollback-8fe8826-20261020-local-review`，保留上一运行版c6d26bb。仅替换dist、操作moneymoney.service，服务active；重启初始两次健康连接尚未建立，重试后alive，未触发回滚。
- 10个既有跑单配置前后指纹相同：`5125162b35c9893e4a9ac7d11c40eeaca7297bd95d7434d6bec70712aa144181`。
- 未跟踪data/research.db保留且Hash未变：`27fd475e523568daa4cdcabf3146917023335a62affe00429babd721b3b79fd1`。磁盘47%，可用约15GiB；未清理任何业务历史。
