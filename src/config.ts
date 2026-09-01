import { config as dotenvConfig } from 'dotenv';
import * as fs from 'fs';
import * as pathMod from 'path';
import crypto from 'node:crypto';
import { ChainId } from '@predictdotfun/sdk';

// Locate the nearest .env without depending on however Windows launched us.
function findEnvFile(startPath: string): string | null {
  let current = pathMod.resolve(startPath);
  if (!fs.existsSync(current) || fs.statSync(current).isFile()) {
    current = pathMod.dirname(current);
  }

  for (let depth = 0; depth < 8; depth++) {
    const candidate = pathMod.join(current, '.env');
    if (fs.existsSync(candidate)) return candidate;

    const parent = pathMod.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

const exeEnv = findEnvFile(process.execPath);
if (exeEnv) dotenvConfig({ path: exeEnv });

try {
  if (!process.env.NETWORK) {
    const cwdEnv = findEnvFile(pathMod.join(process.cwd(), 'app'));
    if (cwdEnv && cwdEnv !== exeEnv) dotenvConfig({ path: cwdEnv });
  }
} catch {}

// ============================================
// CONFIGURATION
// ============================================

export const config = {
  // API Configuration
  apiKey: process.env.API_KEY || '',
  privateKey: process.env.PRIVATE_KEY || '',
  network: (process.env.NETWORK || 'mainnet') as 'mainnet' | 'testnet',
  predictAccount: process.env.PREDICT_ACCOUNT || undefined,

  // Local dashboard binding. Keep localhost as the safe default; set
  // APP_HOST=0.0.0.0 only when the phone/PWA needs LAN access.
  appHost: process.env.APP_HOST || '127.0.0.1',
  appPort: parseInt(process.env.APP_PORT || '3000'),
  lanMode: process.env.MONEYMONEY_LAN_MODE === 'true'
    || !['127.0.0.1', 'localhost', '::1', '[::1]'].includes((process.env.APP_HOST || '127.0.0.1').trim().toLowerCase()),
  accessToken: process.env.MONEYMONEY_ACCESS_TOKEN || '',
  loginUser: process.env.MONEYMONEY_LOGIN_USER || 'admin',
  loginPass: process.env.MONEYMONEY_LOGIN_PASS || 'admin123',
  jwtSecret: (()=>{ const s=process.env.MONEYMONEY_JWT_SECRET; if(s && s!== 'moneymoney-dev-secret-change-me') return s; try{ const g=crypto.randomBytes(32).toString('hex'); if(!process.env.MONEYMONEY_JWT_SECRET) console.warn('\n  ⚠️ MONEYMONEY_JWT_SECRET 未设置，已临时生成随机密钥（重启后失效，请写入 .env）'); return g; }catch{return 'moneymoney-dev-secret-change-me'; } })(),
  loginTokenExpiryMs: parseInt(process.env.MONEYMONEY_LOGIN_EXPIRY_MS || '43200000'),
  aiPaperTradingEnabled: process.env.AI_PAPER_TRADING_ENABLED === 'true',

  // Trading Settings
  defaultSlippageBps: parseInt(process.env.DEFAULT_SLIPPAGE_BPS || '200'),
  orderExpirationSeconds: parseInt(process.env.ORDER_EXPIRATION_SECONDS || '3600'),

  // Derived values
  get chainId(): ChainId {
    return this.network === 'mainnet' ? ChainId.BnbMainnet : ChainId.BnbTestnet;
  },

  get apiBaseUrl(): string {
    return this.network === 'mainnet'
      ? 'https://api.predict.fun'
      : 'https://api-testnet.predict.fun';
  },

  get rpcUrl(): string {
    // Use more reliable RPC endpoints with fallbacks
    return this.network === 'mainnet'
      ? 'https://bsc-dataseed1.binance.org/'
      : 'https://data-seed-prebsc-1-s1.binance.org:8545/';
  }
};

// Validate configuration

// 登录安全状态标记
export function isDefaultLoginCredentials(): boolean { return config.loginUser==='admin' && config.loginPass==='admin123'; }
export function isJwtSecretDefault(): boolean { return !process.env.MONEYMONEY_JWT_SECRET || process.env.MONEYMONEY_JWT_SECRET==='moneymoney-dev-secret-change-me'; }
export function getLoginSecurityStatus(){ return { isDefault: isDefaultLoginCredentials(), isJwtDefault: isJwtSecretDefault(), user: config.loginUser }; }
export function validateConfig(): void {
  const errors: string[] = [];

  if (!config.apiKey && config.network === 'mainnet') {
    errors.push('API_KEY is required for mainnet');
  }

  if (!config.privateKey) {
    errors.push('PRIVATE_KEY is required');
  }

  if (config.lanMode && !config.accessToken && !config.loginUser) {
    errors.push('MONEYMONEY_ACCESS_TOKEN is required when LAN mode is enabled');
  }

  if (errors.length > 0) {
    console.error('\n❌ Configuration errors:');
    errors.forEach(e => console.error(`   - ${e}`));
    console.error('\nPlease check your .env file\n');
    process.exit(1);
  }
}

// Contract addresses from https://dev.predict.fun/-deployed-contracts-1860295m0
export const CONTRACTS = {
  mainnet: {
    // Standard BSC USDT
    USDT: '0x55d398326f99059fF775485246999027B3197955',
    // Yield Bearing Prediction Market
    YIELD_CTF_EXCHANGE: '0x6bEb5a40C032AFc305961162d8204CDA16DECFa5',
    YIELD_CONDITIONAL_TOKENS: '0x9400F8Ad57e9e0F352345935d6D3175975eb1d9F',
    // Non Yield Bearing Prediction Market
    CTF_EXCHANGE: '0x8BC070BEdAB741406F4B1Eb65A72bee27894B689',
    CONDITIONAL_TOKENS: '0x22DA1810B194ca018378464a58f6Ac2B10C9d244',
    // Shared
    VAULT: '0x09F683d8a144c4ac296D770F839098c3377410c5',
  },
  testnet: {
    USDT: '0xB32171ecD878607FFc4F8FC0bCcE6852BB3149E0',
    // Yield Bearing
    YIELD_CTF_EXCHANGE: '0x8a6B4Fa700A1e310b106E7a48bAFa29111f66e89',
    // Non Yield Bearing
    CTF_EXCHANGE: '0x2A6413639BD3d73a20ed8C95F634Ce198ABbd2d7',
    VAULT: '0x415bdd0F4e5eE9A50B2394ff8B6b20319e77255d',
  }
};
