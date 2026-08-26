#!/usr/bin/env ts-node
/**
 * Markets Command - View all OPEN categories and markets
 */

import chalk from 'chalk';
import Table from 'cli-table3';
import { config, validateConfig } from '../config';
import { api } from '../api';

async function main() {
  validateConfig();

  console.log(chalk.bold('\n📊 Predict.fun Markets'));
  console.log(chalk.gray(`Network: ${config.network}\n`));

  // Fetch OPEN categories
  const response = await api.getCategories(50);
  const openCategories = response.data.filter(c => c.status === 'OPEN');

  if (openCategories.length === 0) {
    console.log(chalk.yellow('No open categories found'));
    return;
  }

  console.log(chalk.bold.green(`Open Categories (${openCategories.length}):\n`));

  let totalMarkets = 0;

  openCategories.forEach(cat => {
    console.log(chalk.cyan(`=== ${cat.title} [${cat.id}] ===`));

    const table = new Table({
      head: [
        chalk.cyan('ID'),
        chalk.cyan('Market'),
        chalk.cyan('Outcomes'),
        chalk.cyan('Fee')
      ],
      colWidths: [8, 45, 25, 8]
    });

    cat.markets.forEach(m => {
      const outcomes = m.outcomes.map(o => o.name).join(' / ');
      table.push([
        m.id.toString(),
        m.title.substring(0, 42) + (m.title.length > 42 ? '...' : ''),
        outcomes.substring(0, 22) + (outcomes.length > 22 ? '...' : ''),
        `${m.feeRateBps / 100}%`
      ]);
    });

    console.log(table.toString());
    console.log('');
    totalMarkets += cat.markets.length;
  });

  // Summary
  console.log(chalk.gray(`Total: ${openCategories.length} categories, ${totalMarkets} markets`));
  console.log(chalk.gray(`Use: npm run dev -- to start interactive mode\n`));
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
