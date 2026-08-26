import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.predictfun.bot',
  appName: 'MoneyMoney',
  webDir: 'src/web/public',
  server: {
    url: 'http://192.168.3.77:3000',
    cleartext: true,
  },
};

export default config;

