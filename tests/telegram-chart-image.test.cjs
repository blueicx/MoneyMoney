const test=require('node:test'),assert=require('node:assert/strict');require('ts-node/register/transpile-only');
test('chart PNG uses actual OHLC and rejects malformed or missing bars',()=>{
 const {renderTelegramKline}=require('../src/features/telegram-kline-image');
 const bars=Array.from({length:30},(_,i)=>({open:100+i,high:103+i,low:99+i,close:102+i}));
 const image=renderTelegramKline(bars);assert.equal(image.png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(image.ma5,129);assert.equal(image.ma20,121.5);
 assert.throws(()=>renderTelegramKline([]),/数据/);assert.throws(()=>renderTelegramKline([{open:100,high:90,low:80,close:100}]),/OHLC/);
});
test('bot sends PNG in chat, preserving text and never substituting an image URL',async()=>{
 const {TelegramInteractionBot}=require('../src/features/telegram-bot');const sent=[];
 const bot=new TelegramInteractionBot({allowedChatIds:['owner'],pollStateStore:{get:()=>null,set:()=>{}},transport:{getUpdates:async()=>[],answerCallbackQuery:async()=>{},sendPhoto:async(c,p)=>sent.push(p),sendMessage:async(c,t)=>sent.push(t)},handlers:{chart:()=>({text:'真实行情',photo:Buffer.from('PNG')})}});
 await bot.handleUpdate({update_id:1,message:{chat:{id:'owner',type:'private'},text:'/chart'}});assert.ok(Buffer.isBuffer(sent[0]));assert.equal(sent[1],'真实行情');
});
