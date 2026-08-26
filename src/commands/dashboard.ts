#!/usr/bin/env ts-node
/**
 * Live Dashboard - Simple version
 */

import chalk from 'chalk';
import Table from 'cli-table3';
import inquirer from 'inquirer';
import ora from 'ora';
import { config, validateConfig } from '../config';
import { api } from '../api';
import { tradingEngine } from '../trading';
import { Market, Side, Category } from '../types';

async function displayCategories(): Promise<Category[]> {
  const spinner = ora('Loading categories...').start();

  const catRes = await api.getCategories(50);
  const openCategories = catRes.data.filter(c => c.status === 'OPEN');

  spinner.stop();
  console.clear();
  console.log(chalk.cyan.bold('\n╔══════════════════════════════════════════════════════════════╗'));
  console.log(chalk.cyan.bold('║') + chalk.white.bold('  PREDICT.FUN TRADING DASHBOARD') + '                               ' + chalk.cyan.bold('║'));
  console.log(chalk.cyan.bold('╚══════════════════════════════════════════════════════════════╝\n'));

  openCategories.forEach((cat, i) => {
    const isBinary = cat.markets.length === 1 && cat.markets[0].outcomes.length === 2;

    console.log(chalk.yellow.bold(`[${i + 1}] ${cat.title}`));

    if (isBinary) {
      // Binary market (Yes/No) - compact view
      const m = cat.markets[0];
      const outcomes = m.outcomes.map(o => o.name).join(' / ');
      console.log(chalk.gray(`    Type: Binary (${outcomes})`));
    } else {
      // Multi-outcome market - show all options
      console.log(chalk.gray(`    Type: Multi-outcome (${cat.markets.length} options)`));
      console.log(chalk.cyan('    Options:'));
      cat.markets.forEach((m, j) => {
        const letter = String.fromCharCode(97 + j);
        console.log(chalk.white(`      ${letter}) ${m.title}`));
      });
    }

    // Show full resolution criteria
    if (cat.description) {
      console.log(chalk.yellow('    📋 Resolution Criteria:'));
      // Word wrap at ~75 chars
      const words = cat.description.split(' ');
      let line = '       ';
      words.forEach(word => {
        if (line.length + word.length > 80) {
          console.log(chalk.gray(line));
          line = '       ' + word + ' ';
        } else {
          line += word + ' ';
        }
      });
      if (line.trim()) {
        console.log(chalk.gray(line));
      }
    }
    console.log('');
  });

  console.log(chalk.gray(`Total: ${openCategories.length} categories, ${openCategories.reduce((s, c) => s + c.markets.length, 0)} markets`));
  console.log(chalk.gray(`Updated: ${new Date().toLocaleTimeString()}\n`));

  return openCategories;
}

async function showMarketDetails(market: Market): Promise<void> {
  const spinner = ora('Loading...').start();

  try {
    const [obRes, statsRes] = await Promise.all([
      api.getOrderbook(market.id),
      api.getMarketStats(market.id)
    ]);
    spinner.stop();

    const ob = obRes.data;
    const stats = statsRes.data;

    console.log('');
    console.log(chalk.cyan.bold(`═══════════════════════════════════════════════════════════════`));
    console.log(chalk.cyan.bold(`  ${market.title}`));
    console.log(chalk.cyan.bold(`═══════════════════════════════════════════════════════════════`));

    // Show question
    if (market.question) {
      console.log(chalk.yellow('\n❓ Question:'));
      console.log(chalk.white(`   ${market.question}`));
    }

    // Show resolution criteria
    if (market.description) {
      console.log(chalk.yellow('\n📋 Resolution Criteria:'));
      const desc = market.description;
      const lines = desc.match(/.{1,70}/g) || [desc];
      lines.slice(0, 5).forEach(line => {
        console.log(chalk.gray(`   ${line}`));
      });
      if (lines.length > 5) {
        console.log(chalk.gray(`   ...`));
      }
    }

    console.log(chalk.yellow('\n🎯 Outcomes:'));
    market.outcomes.forEach((o, i) => {
      console.log(chalk.white(`   ${i + 1}. ${o.name}`));
    });

    console.log('');
    console.log(`📊 Volume: ${chalk.magenta('$' + stats.volumeTotalUsd.toFixed(0))} | Liquidity: ${chalk.blue('$' + stats.totalLiquidityUsd.toFixed(0))}`);
    console.log('');

    if (ob.bids.length > 0 || ob.asks.length > 0) {
      const table = new Table({
        head: [chalk.white(''), chalk.green('Bid'), chalk.green('Size'), chalk.red('Ask'), chalk.red('Size')],
        colWidths: [8, 10, 10, 10, 10]
      });

      const maxRows = Math.max(ob.bids.length, ob.asks.length, 5);
      for (let i = 0; i < Math.min(maxRows, 5); i++) {
        const bid = ob.bids[i];
        const ask = ob.asks[i];
        table.push([
          i === 0 ? 'Best' : '',
          bid ? chalk.green(`${(bid[0] * 100).toFixed(0)}¢`) : '-',
          bid ? chalk.green(bid[1].toFixed(0)) : '-',
          ask ? chalk.red(`${(ask[0] * 100).toFixed(0)}¢`) : '-',
          ask ? chalk.red(ask[1].toFixed(0)) : '-'
        ]);
      }
      console.log(table.toString());

      if (ob.bids[0] && ob.asks[0]) {
        const mid = (ob.bids[0][0] + ob.asks[0][0]) / 2;
        console.log(chalk.yellow(`Implied odds: ${(mid * 100).toFixed(0)}%`));
      }
    } else {
      console.log(chalk.yellow('No orders in orderbook'));
    }
    console.log('');

    return;
  } catch (e: any) {
    spinner.fail('Error: ' + e.message);
  }
}

async function placeTrade(market: Market): Promise<void> {
  // Get orderbook first
  const spinner = ora('Loading orderbook...').start();
  let bestBid: number | null = null;
  let bestAsk: number | null = null;

  try {
    const obRes = await api.getOrderbook(market.id);
    spinner.stop();
    bestBid = obRes.data.bids[0]?.[0] || null;
    bestAsk = obRes.data.asks[0]?.[0] || null;
  } catch {
    spinner.stop();
  }

  // Build choices
  const choices: any[] = [];

  if (bestAsk !== null) {
    choices.push({
      name: chalk.green(`BUY YES`) + ` @ ${(bestAsk * 100).toFixed(0)}¢ (betting YES)`,
      value: { side: Side.BUY, outcome: 0, price: bestAsk }
    });
  }

  if (bestBid !== null) {
    choices.push({
      name: chalk.red(`SELL YES`) + ` @ ${(bestBid * 100).toFixed(0)}¢ (betting NO)`,
      value: { side: Side.SELL, outcome: 0, price: bestBid }
    });
  }

  if (choices.length === 0) {
    // No liquidity - offer limit order
    choices.push({
      name: chalk.green('BUY YES (LIMIT)') + ' - set your price',
      value: { side: Side.BUY, outcome: 0, price: null }
    });
    choices.push({
      name: chalk.red('SELL YES (LIMIT)') + ' - set your price',
      value: { side: Side.SELL, outcome: 0, price: null }
    });
  }

  choices.push({ name: chalk.gray('Back'), value: null });

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'Action:',
      choices
    }
  ]);

  if (!action) return;

  // Quantity
  const { quantity } = await inquirer.prompt([
    {
      type: 'input',
      name: 'quantity',
      message: 'Quantity (shares):',
      default: '10',
      validate: v => !isNaN(parseFloat(v)) && parseFloat(v) > 0 ? true : 'Enter a valid number'
    }
  ]);

  // Order type
  const { orderType } = await inquirer.prompt([
    {
      type: 'list',
      name: 'orderType',
      message: 'Order type:',
      choices: [
        { name: 'LIMIT (set price)', value: 'LIMIT' },
        { name: 'MARKET (instant)', value: 'MARKET' }
      ]
    }
  ]);

  let price: number | undefined;
  if (orderType === 'LIMIT') {
    const defaultPrice = action.side === Side.BUY ? (action.price || 0.5) : (action.price || 0.5);
    const { priceInput } = await inquirer.prompt([
      {
        type: 'input',
        name: 'priceInput',
        message: 'Price (0.01-0.99):',
        default: defaultPrice.toFixed(2),
        validate: v => {
          const n = parseFloat(v);
          return !isNaN(n) && n > 0 && n < 1 ? true : 'Must be between 0.01 and 0.99';
        }
      }
    ]);
    price = parseFloat(priceInput);
  }

  const total = price ? (parseFloat(quantity) * price).toFixed(2) : 'market';
  const outcomeName = market.outcomes[action.outcome]?.name || 'YES';

  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: `${action.side === Side.BUY ? 'BUY' : 'SELL'} ${quantity} ${outcomeName} @ $${price?.toFixed(2) || 'market'}? (≈$${total})`,
      default: false
    }
  ]);

  if (!confirm) {
    console.log(chalk.yellow('Cancelled'));
    return;
  }

  const orderSpinner = ora('Placing order...').start();

  try {
    let hash: string;

    if (orderType === 'LIMIT' && price) {
      hash = await tradingEngine.createLimitOrder({
        market,
        side: action.side,
        outcomeIndex: action.outcome,
        pricePerShare: price,
        quantity: parseFloat(quantity)
      });
    } else {
      hash = await tradingEngine.createMarketOrder({
        market,
        side: action.side,
        outcomeIndex: action.outcome,
        quantity: parseFloat(quantity)
      });
    }

    orderSpinner.succeed(chalk.green(`Order placed! Hash: ${hash}`));
  } catch (error: any) {
    orderSpinner.fail(chalk.red('Error: ' + error.message));
  }
}

async function showTopByLiquidity(categories: Category[]): Promise<void> {
  const spinner = ora('Loading market stats...').start();

  try {
    // Collect all markets from all categories
    const allMarkets: { market: Market; category: Category }[] = [];
    categories.forEach(cat => {
      cat.markets.forEach(m => {
        allMarkets.push({ market: m, category: cat });
      });
    });

    // Load stats in batches of 5 (to avoid API overload)
    const marketStats: { market: Market; category: Category; stats: { liquidity: number; volume: number } }[] = [];

    for (let i = 0; i < allMarkets.length; i += 5) {
      const batch = allMarkets.slice(i, i + 5);
      const statsPromises = batch.map(async ({ market, category }) => {
        try {
          const statsRes = await api.getMarketStats(market.id);
          return {
            market,
            category,
            stats: {
              liquidity: statsRes.data.totalLiquidityUsd,
              volume: statsRes.data.volumeTotalUsd
            }
          };
        } catch {
          return {
            market,
            category,
            stats: { liquidity: 0, volume: 0 }
          };
        }
      });

      const results = await Promise.all(statsPromises);
      marketStats.push(...results);

      // Small delay between batches
      if (i + 5 < allMarkets.length) {
        await new Promise(r => setTimeout(r, 100));
      }
    }

    spinner.stop();

    // Sort by liquidity
    marketStats.sort((a, b) => b.stats.liquidity - a.stats.liquidity);

    // Show top 10
    console.log(chalk.cyan.bold('\n🏆 TOP 10 by Liquidity:\n'));

    marketStats.slice(0, 10).forEach((item, i) => {
      console.log(chalk.yellow.bold(`${i + 1}. ${item.category.title}`));
      console.log(chalk.white(`   Market: ${item.market.title}`));
      console.log(chalk.blue(`   Liquidity: $${item.stats.liquidity.toFixed(0)}`) + chalk.gray(' | ') + chalk.magenta(`Volume: $${item.stats.volume.toFixed(0)}`));
      console.log('');
    });
    console.log('');

  } catch (e: any) {
    spinner.fail('Error: ' + e.message);
  }
}

async function mainLoop(): Promise<void> {
  while (true) {
    let categories: Category[];

    try {
      categories = await displayCategories();
    } catch (e: any) {
      console.log(chalk.red('\n⚠️  Loading error: ' + e.message));
      console.log(chalk.gray('This could be a network issue or API problem.'));
      console.log(chalk.gray('Check your internet connection and API key.\n'));
      await inquirer.prompt([{ type: 'input', name: 'x', message: 'Press Enter to retry...' }]);
      continue;
    }

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'Action:',
        choices: [
          { name: '🔄  Refresh', value: 'refresh' },
          { name: '🏆  Top by Liquidity', value: 'top' },
          { name: '📊  View Market', value: 'view' },
          { name: '🛒  Trade', value: 'trade' },
          { name: '💰  Balance', value: 'balance' },
          { name: '📋  Positions', value: 'positions' },
          { name: '📝  Orders', value: 'orders' },
          { name: '🚪  Exit', value: 'exit' }
        ]
      }
    ]);

    if (action === 'refresh') continue;
    if (action === 'exit') {
      console.log(chalk.cyan('\nGoodbye!\n'));
      process.exit(0);
    }

    if (action === 'top') {
      await showTopByLiquidity(categories);
      await inquirer.prompt([{ type: 'input', name: 'x', message: 'Press Enter...' }]);
      continue;
    }

    if (action === 'balance') {
      try {
        const balance = await tradingEngine.getBalance();
        console.log(chalk.green(`\nBalance: ${balance.formatted} USDT\n`));
      } catch (e: any) {
        console.log(chalk.red('Error: ' + e.message));
      }
      await inquirer.prompt([{ type: 'input', name: 'x', message: 'Press Enter...' }]);
      continue;
    }

    if (action === 'positions') {
      try {
        const pos = await api.getPositions();
        console.log(chalk.cyan('\n=== Positions ==='));
        if (pos.data.length === 0) {
          console.log(chalk.yellow('No positions'));
        } else {
          pos.data.forEach(p => {
            console.log(`${p.market.title}: ${p.outcome.name} = $${parseFloat(p.valueUsd).toFixed(2)}`);
          });
        }
        console.log('');
      } catch (e: any) {
        console.log(chalk.red('Error: ' + e.message));
      }
      await inquirer.prompt([{ type: 'input', name: 'x', message: 'Press Enter...' }]);
      continue;
    }

    if (action === 'orders') {
      try {
        const orders = await api.getOrders('OPEN');
        console.log(chalk.cyan('\n=== Open Orders ==='));
        if (orders.data.length === 0) {
          console.log(chalk.yellow('No open orders'));
        } else {
          orders.data.forEach(o => {
            console.log(`${o.id.substring(0, 10)}... | #${o.marketId} | ${o.order.side === 0 ? 'BUY' : 'SELL'}`);
          });
        }
        console.log('');
      } catch (e: any) {
        console.log(chalk.red('Error: ' + e.message));
      }
      await inquirer.prompt([{ type: 'input', name: 'x', message: 'Press Enter...' }]);
      continue;
    }

    // View or Trade - select category and market
    const { catIndex } = await inquirer.prompt([
      {
        type: 'list',
        name: 'catIndex',
        message: 'Select category:',
        choices: categories.map((cat, i) => ({
          name: `[${i + 1}] ${cat.title}`,
          value: i
        })),
        pageSize: 15
      }
    ]);

    const category = categories[catIndex];

    const { marketIndex } = await inquirer.prompt([
      {
        type: 'list',
        name: 'marketIndex',
        message: 'Select market:',
        choices: category.markets.map((m, i) => ({
          name: `${String.fromCharCode(97 + i)}) ${m.title}`,
          value: i
        }))
      }
    ]);

    const market = category.markets[marketIndex];

    if (action === 'view') {
      await showMarketDetails(market);
      await inquirer.prompt([{ type: 'input', name: 'x', message: 'Press Enter...' }]);
    } else if (action === 'trade') {
      await showMarketDetails(market);
      await placeTrade(market);
      await inquirer.prompt([{ type: 'input', name: 'x', message: 'Press Enter...' }]);
    }
  }
}

async function main() {
  validateConfig();

  console.log(chalk.cyan('\n  Initializing...\n'));

  try {
    await tradingEngine.initialize();
    console.log(chalk.green('  Ready!\n'));
  } catch (error: any) {
    console.error(chalk.red('  Error: ' + error.message));
    process.exit(1);
  }

  // Start main loop
  await mainLoop();
}

main().catch(console.error);
