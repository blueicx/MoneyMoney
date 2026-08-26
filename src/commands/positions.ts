#!/usr/bin/env ts-node
/**
 * Positions Command - View your current positions
 */

import chalk from 'chalk';
import Table from 'cli-table3';
import { formatUnits } from 'ethers';
import { config, validateConfig } from '../config';
import { api } from '../api';
import { tradingEngine } from '../trading';

async function main() {
  validateConfig();

  console.log(chalk.bold('\n📋 Your Positions'));
  console.log(chalk.gray(`Network: ${config.network}\n`));

  // Initialize to authenticate
  await tradingEngine.initialize();

  const response = await api.getPositions();
  const positions = response.data;

  if (positions.length === 0) {
    console.log(chalk.yellow('No positions found'));
    console.log(chalk.gray('\nStart trading to see positions here!\n'));
    return;
  }

  const table = new Table({
    head: [
      chalk.cyan('Market'),
      chalk.cyan('Outcome'),
      chalk.cyan('Shares'),
      chalk.cyan('Value'),
      chalk.cyan('Status')
    ],
    colWidths: [35, 12, 18, 12, 12]
  });

  let totalValue = 0;

  positions.forEach(p => {
    const value = parseFloat(p.valueUsd);
    totalValue += value;

    table.push([
      p.market.title.substring(0, 32) + (p.market.title.length > 32 ? '...' : ''),
      p.outcome.name,
      formatUnits(p.amount, 18),
      `$${value.toFixed(2)}`,
      p.market.status
    ]);
  });

  console.log(table.toString());
  console.log(chalk.bold(`\nTotal Value: ${chalk.green(`$${totalValue.toFixed(2)}`)}`));
  console.log('');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
