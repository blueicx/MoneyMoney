// Run on the existing VPS only. No getUpdates, polling instance, fabricated events or orders.
const path=require('node:path');
const root=process.env.MONEYMONEY_APP_ROOT || process.cwd();
async function main(){
 const {getRuntimeTelegramConfig,parseChatIds}=require(path.join(root,'dist/config/runtime-secrets'));
 const {TelegramApiTransport}=require(path.join(root,'dist/features/telegram-bot'));
 const {ContractResearchService}=require(path.join(root,'dist/features/contract-research'));
 const {renderTelegramKline}=require(path.join(root,'dist/features/telegram-kline-image'));
 const config=getRuntimeTelegramConfig(),allowed=parseChatIds(config.allowedChatIds,config.chatId),admins=parseChatIds(config.adminChatIds,config.chatId);
 const chat=allowed.find(id=>admins.includes(id));
 if(!config.botToken || !chat || String(chat).startsWith('-'))throw Error('Configured private administrator chat unavailable');
 const detail=await new ContractResearchService().detail('crypto:gateio:BTC_USDT');
 if(detail.candles.length<20)throw Error('Real contract candles unavailable');
 const image=renderTelegramKline(detail.candles);
 console.log(JSON.stringify({configured:true,candles:detail.candles.length,pngBytes:image.png.length,dataStatus:detail.dataStatus,ordersEnabled:false}));
 if(!process.argv.includes('--send'))return;
 const transport=new TelegramApiTransport(config.botToken,config.proxyUrl);
 await transport.sendPhoto(chat,image.png);
 await transport.sendMessage(chat,'✅ MoneyMoney TG 更新验收\n上图来自 Gate BTC_USDT 永续真实已完成小时K线，不是现货或预测数据。\nMA5：'+image.ma5?.toFixed(2)+' · MA10：'+image.ma10?.toFixed(2)+' · MA20：'+image.ma20?.toFixed(2)+'\n来源：'+detail.source+'\n抓取时间：'+detail.updatedAt+'\n事件结束后会继续跟踪结果；来源不提供实际值时明确通知原因。可用 /eventresults 查看投递记录。\n仅研究，不构成交易指令。');
 console.log('Telegram API accepted the real-data PNG and administrator release message.');
}
main().catch(()=>{console.error('Telegram release smoke failed; no credentials or private identifiers logged.');process.exitCode=1;});
