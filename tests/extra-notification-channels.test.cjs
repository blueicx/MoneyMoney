const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs');
require('ts-node/register/transpile-only');
const hooks=()=>require('../src/features/extra-notification-channels');
const env=()=>({DISCORD_WEBHOOK_URL:'https://discord.com/api/webhooks/123/unit-test-placeholder',LARK_WEBHOOK_URL:'https://open.feishu.cn/open-apis/bot/v2/hook/unit-test-placeholder',MONEYMONEY_WEBHOOK_URL:'https://automation.example.test/hook',MONEYMONEY_WEBHOOK_ALLOWED_HOSTS:'automation.example.test',MONEYMONEY_WEBHOOK_SECRET:'local-test-signature-not-production'});
test('new channels are off without configuration and reject unsafe or non-allowlisted destinations',()=>{
 const {extraChannelsConfigured,isPublicWebhookAddress}=hooks();assert.deepEqual(extraChannelsConfigured({}),{discord:false,lark:false,webhook:false});
 for(const url of ['http://automation.example.test/hook','https://127.0.0.1/hook','https://localhost/hook','https://user:pass@automation.example.test/hook','https://other.example.test/hook'])assert.equal(extraChannelsConfigured({...env(),MONEYMONEY_WEBHOOK_URL:url}).webhook,false);
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1','100.64.0.1','::1','fc00::1','fe80::1','::ffff:127.0.0.1','2001:db8::1'])assert.equal(isPublicWebhookAddress(ip),false,ip);
 assert.equal(isPublicWebhookAddress('8.8.8.8'),true);assert.equal(isPublicWebhookAddress('2606:4700:4700::1111'),true);
});
test('Discord suppresses mentions, Lark uses text schema, JSON webhook includes verifiable signature; errors are isolated',async()=>{
 const {sendExtraNotifications}=hooks(),calls=[];
 const result=await sendExtraNotifications({title:'Research',body:'<b>Evidence</b> @everyone '+'x'.repeat(2500)},{env:env(),post:async(url,payload,headers)=>{calls.push({url,payload,headers});if(url.hostname==='open.feishu.cn')throw new Error('source unavailable');return true;}});
 assert.deepEqual(result,{discord:true,lark:false,webhook:true});
 const discord=calls.find(x=>x.url.hostname==='discord.com');assert.deepEqual(discord.payload.allowed_mentions,{parse:[]});assert.ok(discord.payload.content.length<=2000);assert.equal(discord.url.searchParams.get('wait'),'true');
 const lark=calls.find(x=>x.url.hostname==='open.feishu.cn');assert.equal(lark.payload.msg_type,'text');assert.ok(lark.payload.content.text);
 const generic=calls.find(x=>x.url.hostname==='automation.example.test');const expected=crypto.createHmac('sha256',env().MONEYMONEY_WEBHOOK_SECRET).update(generic.headers['X-MoneyMoney-Timestamp']+'.'+JSON.stringify(generic.payload)).digest('hex');assert.equal(generic.headers['X-MoneyMoney-Signature'],'sha256='+expected);
 assert.equal(generic.payload.schemaVersion,1);assert.equal(generic.payload.executionEnabled,false);
});
test('existing notification fanout and notifier gate include new channels without requiring Telegram configuration',()=>{
 const channels=fs.readFileSync('src/features/notification-channels.ts','utf8'),notifier=fs.readFileSync('src/features/high-success-notifier.ts','utf8');
 assert.match(channels,/sendExtraNotifications/);assert.match(channels,/extraChannelsConfigured/);assert.match(notifier,/Object\.values\(configured\)\.some\(Boolean\)/);
});
