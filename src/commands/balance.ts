#!/usr/bin/env ts-node
/**
 * Balance Command - Check your USDT balance
 */

import chalk from 'chalk';
import { config, validateConfig } from '../config';
import { tradingEngine } from '../trading';

async function main() {
  validateConfig();

  console.log(chalk.bold('\n💰 Wallet Balance'));
  console.log(chalk.gray(`Network: ${config.network}\n`));

  // Initialize
  await tradingEngine.initialize();

  const balance = await tradingEngine.getBalance();

  console.log(`Address: ${chalk.cyan(tradingEngine.getSignerAddress())}`);
  console.log(`Balance: ${chalk.green(balance.formatted)} USDT`);
  console.log('');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
