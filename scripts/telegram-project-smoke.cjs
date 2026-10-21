// Isolated compiled application handlers + real bot parser. Never contacts Telegram.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mm-telegram-project-smoke-'));
for(const key of Object.keys(process.env))if(/TOKEN|API_KEY|WEBHOOK|PRIVATE_KEY|BARK_DEVICE_KEY|TELEGRAM_CHAT|TELEGRAM_ALLOWED|TELEGRAM_ADMIN/.test(key))process.env[key]='';
Object.assign(process.env,{MONEYMONEY_DATA_DIR:dir,MONEYMONEY_JWT_SECRET:'isolated-project-smoke-secret-not-production-012345',TELEGRAM_ALLOWED_CHAT_IDS:'123,999',TELEGRAM_ADMIN_CHAT_IDS:'123',TELEGRAM_NETWORK_ENABLED:'false',TELEGRAM_POLLING_ENABLED:'false',AI_PAPER_TRADING_ENABLED:'false',MONEYMONEY_DISABLE_GURU_REFRESH:'true',PUBLIC_WEB_BASE_URL:'https://example.com'});
let networkCalls=0;global.fetch=async()=>{networkCalls++;throw Error('offline smoke forbids provider calls');};
const {stateStore}=require('../dist/storage/sqlite-state');
const {ResearchProjectStore}=require('../dist/features/research-projects');
const {TelegramInteractionBot}=require('../dist/features/telegram-bot');
async function main(){
 const {getTelegramCommandHandlers}=require('../dist/web/server'),{telegramCommandCenterStore}=require('../dist/features/telegram-command-center');
 telegramCommandCenterStore.setActiveMarketScope('123','stocks');telegramCommandCenterStore.setActiveMarketScope('999','stocks');
 const projects=new ResearchProjectStore(stateStore,()=>null),p=projects.create({market:'stocks',title:'Isolated <private> project',question:'Saved question',hypothesis:'Hypothesis',counterEvidence:'Counter evidence',acceptance:'Acceptance'}),sent=[];
 const before=JSON.stringify(stateStore.get('ai-paper-runners'));
 const bot=new TelegramInteractionBot({allowedChatIds:['123','999'],pollStateStore:stateStore,handlers:getTelegramCommandHandlers(),transport:{async getUpdates(){assert.fail('polling disabled');},async sendMessage(chat,text){sent.push({chat,text});}}});
 let id=0;const send=(text,chat='123',type='private')=>bot.handleUpdate({update_id:++id,message:{chat:{id:chat,type},text}});
 await send('/projects');assert.match(sent.at(-1).text,/Isolated &lt;private&gt;/);assert.equal(stateStore.get('telegram:research-project-subscriptions:v1:123'),null);
 await send('/projects subscribe '+p.id);assert.match(sent.at(-1).text,/已订阅/);assert.equal(stateStore.get('telegram:research-project-subscriptions:v1:123')[0].enabled,true);
 await send('/projects status');assert.match(sent.at(-1).text,/待投递 0/);assert.doesNotMatch(sent.at(-1).text,/<项目ID>/);
 await send('/projects show '+p.id);assert.match(sent.at(-1).text,/Saved question/);
 await send('/projects','999');assert.match(sent.at(-1).text,/管理员/);assert.doesNotMatch(sent.at(-1).text,/Isolated/);
 await send('/projects','123','group');assert.match(sent.at(-1).text,/群组入口关闭/);
 telegramCommandCenterStore.setActiveMarketScope('123','crypto');await send('/projects show '+p.id);assert.match(sent.at(-1).text,/市场/);assert.doesNotMatch(sent.at(-1).text,/Saved question/);
 telegramCommandCenterStore.setActiveMarketScope('123','stocks');await send('/projects unsubscribe '+p.id);assert.match(sent.at(-1).text,/已取消/);assert.equal(stateStore.get('telegram:research-project-subscriptions:v1:123')[0].enabled,false);
 const {researchRepository}=require('../dist/features/research-repository');researchRepository.saveAlertDelivery({id:'research-project:isolated-retry',alertId:p.id,context:{market:'stocks',workspace:'research-lab'},status:'failed',channel:'telegram',attempts:1,payload:{chatId:'123',message:'must not be sent through generic retry'}});await send('/delivery retry research-project:isolated-retry');assert.match(sent.at(-1).text,/不通过通用入口/);assert.equal(researchRepository.getAlertDelivery('research-project:isolated-retry').attempts,1);
 assert.equal(JSON.stringify(stateStore.get('ai-paper-runners')),before);assert.equal(networkCalls,0);assert.ok(sent.every(row=>row.text.length<=4096));
 console.log(JSON.stringify({ok:true,compiledApplicationHandlers:true,realBotParser:true,privateMarketGuards:true,explicitSubscribeCancel:true,noProductionMessage:true,noProviderCalls:true,noModelsOrOrders:true,artifacts:dir}));
}
main().then(()=>{stateStore.close();process.exit(0);}).catch(error=>{console.error(error);process.exit(1);});
