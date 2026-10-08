// VPS acceptance only: no poller, orders, model calls or production queue writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
let acceptanceStage='initialization';
function selectFundingEvent(snapshot,now=Date.now()){
  assert.equal(snapshot?.market,'crypto');assert.equal(snapshot.instrument,'crypto:gateio:BTC_USDT');
  const section=snapshot.sections?.funding;
  assert.ok(['delayed','cached','historical','live'].includes(section?.dataStatus));
  const url=new URL(section.source);
  assert.ok(url.protocol==='https:'&&url.hostname==='api.gateio.ws'&&!url.username&&!url.password&&!url.port&&url.pathname==='/api/v4/futures/usdt/funding_rate');
  assert.ok(Number.isFinite(now)&&Array.isArray(snapshot.funding)&&snapshot.funding.length);
  const rows=snapshot.funding.filter(row=>typeof row.ratePct==='number'&&Number.isFinite(row.ratePct)&&
    Number.isFinite(Date.parse(row.at))&&Date.parse(row.at)<=now&&Date.parse(row.at)>=now-48*3600000).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
  assert.ok(rows.length,'no recent verified actual funding record');
  const date=rows[0].at;
  assert.equal(snapshot.funding.filter(row=>row.at===date).length,1,'ambiguous funding result');
  return {kind:'funding',market:'crypto',instrument:snapshot.instrument,
    title:'BTC_USDT 实际资金结算（已发生记录验收）',date};
}

async function main(){
  acceptanceStage='configuration';
  const root='/opt/moneymoney';process.chdir(root);
  const env=require(root+'/node_modules/dotenv').parse(fs.readFileSync('/etc/moneymoney/moneymoney.env'));
  Object.assign(process.env,env);
  const {getRuntimeTelegramConfig,parseChatIds}=require(root+'/dist/config/runtime-secrets');
  const {ContractResearchService}=require(root+'/dist/features/contract-research');
  const config=getRuntimeTelegramConfig(),allowed=parseChatIds(config.allowedChatIds,config.chatId),admins=parseChatIds(config.adminChatIds,config.chatId);
  const chat=allowed.find(id=>admins.includes(id)&&/^\d+$/.test(id));
  assert.ok(config.botToken&&chat,'configured private administrator chat unavailable');
  const service=new ContractResearchService(),snapshot=await service.detail('crypto:gateio:BTC_USDT',['funding']);
  acceptanceStage='source-validation';
  let event;
  try{event=selectFundingEvent(snapshot);}catch(error){console.log(JSON.stringify({preflightOnly:true,sourceStatus:snapshot.sections?.funding?.dataStatus,quoteStatus:snapshot.sections?.quote?.dataStatus,records:snapshot.funding?.length||0,modelCalls:0,pollingStarted:false}));throw error;}
  const moduleDir=process.env.MONEYMONEY_RESULT_MODULE_DIR;
  acceptanceStage='staged-imports';
  assert.ok(/^\/tmp\/moneymoney-result-stage-[a-zA-Z0-9_-]+\/dist\/features$/.test(moduleDir||''),'isolated staged module directory required');
  // Staged imports must never open the production SQLite database or saved command state.
  process.env.MONEYMONEY_DATA_DIR=fs.mkdtempSync('/tmp/moneymoney-result-check-');
  Object.assign(process.env,{TELEGRAM_BOT_TOKEN:config.botToken,TELEGRAM_CHAT_ID:config.chatId,
    TELEGRAM_ALLOWED_CHAT_IDS:config.allowedChatIds,TELEGRAM_ADMIN_CHAT_IDS:config.adminChatIds,TELEGRAM_PROXY_URL:config.proxyUrl});
  const {TelegramApiTransport}=require(path.join(moduleDir,'telegram-bot'));
  const transport=new TelegramApiTransport(config.botToken,config.proxyUrl);
  acceptanceStage='transport-capability';
  assert.equal(transport.resultReplyProtocolVersion,1,'result reply protocol unsupported; no message sent');
  const {TelegramEventResultMonitor}=require(path.join(moduleDir,'telegram-event-results'));
  const {lookupTrackedResult}=require(path.join(moduleDir,'telegram-result-adapters'));
  const lookup=tracked=>lookupTrackedResult(tracked,{contract:async instrument=>{assert.equal(instrument,snapshot.instrument);return snapshot;}});
  const actual=await lookup(event);assert.equal(actual.status,'published');assert.ok(actual.actual&&actual.publishedAt===event.date);
  if(!process.argv.includes('--send')){console.log(JSON.stringify({ok:true,preflightOnly:true,source:actual.source,publishedAt:actual.publishedAt,records:snapshot.funding.length,modelCalls:0,pollingStarted:false}));return;}
  const output=process.argv[process.argv.indexOf('--send')+1];
  acceptanceStage='acceptance-directory';
  assert.ok(/^\/tmp\/moneymoney-telegram-result-[a-zA-Z0-9_-]+$/.test(output||''),'bounded unique acceptance directory required');
  // A repeat invocation must stop before sending another original message.
  fs.mkdirSync(output,{mode:0o700});
  const Database=require(root+'/node_modules/better-sqlite3'),db=new Database(path.join(output,'acceptance.sqlite'));
  fs.chmodSync(path.join(output,'acceptance.sqlite'),0o600);
  db.exec('CREATE TABLE documents(key TEXT PRIMARY KEY,payload TEXT NOT NULL); CREATE TABLE leases(key TEXT PRIMARY KEY,owner TEXT NOT NULL,expires INTEGER NOT NULL)');
  const store={
    get:key=>{const row=db.prepare('SELECT payload FROM documents WHERE key=?').get(key);return row?JSON.parse(row.payload):null;},
    set:(key,value)=>db.prepare('INSERT INTO documents VALUES(?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload').run(key,JSON.stringify(value)),
    acquireLease:(key,owner,now,ttl)=>db.prepare('INSERT INTO leases VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE leases.expires<=? OR leases.owner=?').run(key,owner,now+ttl,now,owner).changes===1,
    refreshLease:(key,owner,now,ttl)=>db.prepare('UPDATE leases SET expires=? WHERE key=? AND owner=? AND expires>?').run(now+ttl,key,owner,now).changes===1,
    releaseLease:(key,owner)=>db.prepare('DELETE FROM leases WHERE key=? AND owner=?').run(key,owner),
  };
  try{
    acceptanceStage='original-send';
    const original=await transport.sendMessage(chat,'<b>MoneyMoney 结果闭环验收</b>\n本次核验 Gate BTC_USDT 已发生的真实资金结算记录；不是未来事件或交易信号。\n结算时间：'+event.date+'\n下一条结果将回复本消息。');
    assert.ok(Number.isSafeInteger(original)&&original>0,'original Telegram receipt unavailable');
    acceptanceStage='result-send';
    let monitor=new TelegramEventResultMonitor(store,lookup),sends=0;
    monitor.registerReminder(chat,event,original);
    await monitor.run(chat,[],async(text,reply)=>{assert.equal(reply,original);sends++;return transport.sendMessage(chat,text,undefined,reply);});
    let delivery=monitor.history(chat)[0];assert.equal(delivery.status,'sent');assert.ok(Number.isSafeInteger(delivery.messageId)&&delivery.messageId>0);
    acceptanceStage='restart-and-ack';
    monitor=new TelegramEventResultMonitor(store,lookup);
    await monitor.run(chat,[],async()=>assert.fail('result repeated after restart'));
    assert.equal(monitor.update(chat,delivery.id,'ack'),true);
    monitor=new TelegramEventResultMonitor(store,lookup);assert.equal(monitor.history(chat)[0].status,'acknowledged');
    const report={ok:true,source:actual.source,publishedAt:actual.publishedAt,resultApiAccepted:true,originalReplyVerified:true,durableRestartDedup:true,programmaticAckPreserved:true,resultMessages:sends,modelCalls:0,pollingStarted:false,productionQueueModified:false};
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
    console.log(JSON.stringify(report));
  }finally{db.close();}
}
if(require.main===module)main().catch(error=>{const code=['MODULE_NOT_FOUND','ERR_DLOPEN_FAILED','ERR_ASSERTION','EEXIST'].includes(error?.code)?error.code:'unclassified';console.error('Telegram real result acceptance failed at '+acceptanceStage+' ('+code+'); no secrets or private identifiers logged.');process.exitCode=1;});
module.exports={selectFundingEvent};
