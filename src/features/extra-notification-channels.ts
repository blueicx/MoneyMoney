import crypto from 'node:crypto';
import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';

type HookEnvironment = Record<string, string | undefined>;
type JsonPost = (url: URL, payload: Record<string, unknown>, headers?: Record<string, string>) => Promise<boolean>;

export function isPublicWebhookAddress(address: string): boolean {
  if (net.isIP(address) === 4) {
    const [a,b,c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 88 && c === 99) || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
  }
  // Fail closed for mapped, link-local, ULA, multicast and transition/documentation IPv6.
  if (net.isIP(address) === 6) return /^[23]/i.test(address) && !/^(2001:(db8|0|10|20):|2002:)/i.test(address);
  return false;
}
function hookUrl(raw: string | undefined): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || url.hostname.endsWith('.') || url.hostname.toLowerCase() === 'localhost' || url.hostname.endsWith('.local') || url.hostname.endsWith('.internal')) return null;
    if (net.isIP(url.hostname.replace(/^\[|\]$/g,'')) && !isPublicWebhookAddress(url.hostname.replace(/^\[|\]$/g,''))) return null;
    return url;
  } catch { return null; }
}
function destinations(env: HookEnvironment) {
  const discord = hookUrl(env.DISCORD_WEBHOOK_URL), lark = hookUrl(env.LARK_WEBHOOK_URL), webhook = hookUrl(env.MONEYMONEY_WEBHOOK_URL);
  const allowed = String(env.MONEYMONEY_WEBHOOK_ALLOWED_HOSTS || '').split(',').map(host => host.trim().toLowerCase()).filter(Boolean);
  return {
    discord: discord?.hostname === 'discord.com' && /^\/api(?:\/v\d+)?\/webhooks\/\d+\/[\w-]+$/.test(discord.pathname) && !discord.search ? discord : null,
    lark: lark && ['open.feishu.cn','open.larksuite.com'].includes(lark.hostname) && /^\/open-apis\/bot\/v2\/hook\/[\w-]+$/.test(lark.pathname) && !lark.search ? lark : null,
    webhook: webhook && allowed.includes(webhook.hostname) && String(env.MONEYMONEY_WEBHOOK_SECRET || '').length >= 16 ? webhook : null,
  };
}
export function extraChannelsConfigured(env: HookEnvironment = process.env) {
  const urls = destinations(env);
  return {discord:!!urls.discord,lark:!!urls.lark,webhook:!!urls.webhook};
}

/** Resolve once, reject all non-public answers, pin the TCP address and retain the original TLS SNI/Host. */
async function safeHttpsJson(url: URL, payload: Record<string, unknown>, headers: Record<string, string> = {}): Promise<boolean> {
  const records = await Promise.race([
    dns.lookup(url.hostname, {all:true}),
    new Promise<never>((_,reject) => { const timer=setTimeout(()=>reject(new Error('DNS timeout')),5000);timer.unref(); }),
  ]);
  if (!records.length || records.some(row => !isPublicWebhookAddress(row.address))) return false;
  const data = JSON.stringify(payload), record = records[0];
  return new Promise<boolean>(resolve => {
    const request = https.request({hostname:record.address,servername:url.hostname,port:443,method:'POST',path:url.pathname+url.search,
      agent:false,rejectUnauthorized:true,headers:{Host:url.hostname,'Content-Type':'application/json','Content-Length':Buffer.byteLength(data),...headers}}, response => {
      let size=0;const chunks: Buffer[]=[];
      response.on('data',chunk=>{size+=chunk.length;if(size>16384){response.destroy();resolve(false);}else chunks.push(chunk);});
      response.on('error',()=>resolve(false));
      response.on('end',()=>{
        const ok = (response.statusCode || 0) >= 200 && (response.statusCode || 0) < 300;
        if (!ok) {resolve(false);return;}
        if (['open.feishu.cn','open.larksuite.com'].includes(url.hostname)) {
          try {const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));resolve(body.code===0 || body.StatusCode===0);}catch{resolve(false);}
        } else resolve(true);
      });
    });
    const deadline=setTimeout(()=>{request.destroy();resolve(false);},10_000);
    request.on('close',()=>clearTimeout(deadline));
    request.on('error',()=>resolve(false));
    request.end(data);
  });
}

export async function sendExtraNotifications(input: {title:string;body:string}, deps: {env?:HookEnvironment;post?:JsonPost} = {}) {
  const env=deps.env || process.env, urls=destinations(env), post=deps.post || safeHttpsJson;
  const title=input.title.replace(/\s+/g,' ').slice(0,100);
  const text=input.body.replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]*>/g,'').slice(0,3000);
  const timestamp=String(Math.floor(Date.now()/1000));
  const content=title+'\n'+text;
  const jsonPayload={schemaVersion:1,id:crypto.createHash('sha256').update(content).digest('hex'),kind:'research-notification',title,body:text,generatedAt:new Date().toISOString(),executionEnabled:false};
  const larkPayload: Record<string,unknown>={msg_type:'text',content:{text:content}};
  if (env.LARK_WEBHOOK_SECRET) {
    larkPayload.timestamp=timestamp;
    larkPayload.sign=crypto.createHmac('sha256',timestamp+'\n'+env.LARK_WEBHOOK_SECRET).update('').digest('base64');
  }
  const tasks = [
    urls.discord ? post(new URL(urls.discord.toString()+'?wait=true'),{content:content.slice(0,2000),allowed_mentions:{parse:[]}}) : Promise.resolve(false),
    urls.lark ? post(urls.lark,larkPayload) : Promise.resolve(false),
    urls.webhook ? post(urls.webhook,jsonPayload,{'X-MoneyMoney-Timestamp':timestamp,'X-MoneyMoney-Signature':'sha256='+crypto.createHmac('sha256',env.MONEYMONEY_WEBHOOK_SECRET!).update(timestamp+'.'+JSON.stringify(jsonPayload)).digest('hex')}) : Promise.resolve(false),
  ];
  const results=await Promise.allSettled(tasks);
  const sent=(i:number)=>results[i].status==='fulfilled' && results[i].value===true;
  return {discord:sent(0),lark:sent(1),webhook:sent(2)};
}
