import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import Table from 'cli-table3';
import { formatUnits, parseUnits } from 'ethers';

import { config, validateConfig } from './config';
import { api } from './api';
import { tradingEngine, TradingEngine } from './trading';
import { Market, Side } from './types';

// ============================================
// PREDICT.FUN TRADING BOT
// ============================================

const LOGO = `
${chalk.cyan('╔═══════════════════════════════════════════════════════════╗')}
${chalk.cyan('║')}  ${chalk.bold.white('PREDICT.FUN')} ${chalk.yellow('Trading Bot')}                               ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.gray('Trade on prediction markets with ease')}                    ${chalk.cyan('║')}
${chalk.cyan('╚═══════════════════════════════════════════════════════════╝')}
`;

async function displayMarkets(): Promise<void> {
  const spinner = ora('Fetching OPEN categories...').start();

  try {
    const response = await api.getCategories(50);
    spinner.stop();

    // Filter OPEN categories only
    const openCategories = response.data.filter(c => c.status === 'OPEN');

    if (openCategories.length === 0) {
      console.log(chalk.yellow('No open categories found'));
      return;
    }

    console.log('\n' + chalk.bold(`Open Categories (${openCategories.length}):`));

    openCategories.forEach(cat => {
      console.log('\n' + chalk.cyan(`=== ${cat.title} [${cat.id}] ===`));

      const table = new Table({
        head: [
          chalk.cyan('ID'),
          chalk.cyan('Market'),
          chalk.cyan('Status'),
          chalk.cyan('Fee')
        ],
        colWidths: [8, 55, 14, 8]
      });

      cat.markets.forEach(m => {
        table.push([
          m.id.toString(),
          m.title.substring(0, 52) + (m.title.length > 52 ? '...' : ''),
          m.status,
          `${m.feeRateBps / 100}%`
        ]);
      });

      console.log(table.toString());
    });

    // Summary
    const totalMarkets = openCategories.reduce((sum, c) => sum + c.markets.length, 0);
    console.log(chalk.gray(`\nTotal: ${openCategories.length} categories, ${totalMarkets} markets`));
  } catch (error) {
    spinner.fail('Failed to fetch categories');
    console.error(error);
  }
}

async function displayOrderbook(marketId: number): Promise<void> {
  const spinner = ora('Fetching orderbook...').start();

  try {
    const [marketRes, orderbookRes, statsRes] = await Promise.all([
      api.getMarketById(marketId),
      api.getOrderbook(marketId),
      api.getMarketStats(marketId)
    ]);

    spinner.stop();

    const market = marketRes.data;
    const orderbook = orderbookRes.data;
    const stats = statsRes.data;

    console.log('\n' + chalk.bold(`Market: ${market.title}`));
    console.log(chalk.gray(`Question: ${market.question}`));
    console.log(chalk.gray(`Status: ${market.status} | Fee: ${market.feeRateBps / 100}%`));
    console.log(chalk.gray(`Volume 24h: $${stats.volume24hUsd.toFixed(2)} | Total: $${stats.volumeTotalUsd.toFixed(2)}`));

    console.log('\n' + chalk.bold('Outcomes:'));
    market.outcomes.forEach((o, i) => {
      console.log(`  ${i}: ${o.name} (Token ID: ${o.onChainId})`);
    });

    const prices = TradingEngine.getBestPrices(orderbook);

    console.log('\n' + chalk.bold('Orderbook (YES side):'));
    console.log(chalk.green(`  Best Bid: ${prices.bestBid !== null ? `$${prices.bestBid.toFixed(3)}` : 'N/A'}`));
    console.log(chalk.red(`  Best Ask: ${prices.bestAsk !== null ? `$${prices.bestAsk.toFixed(3)}` : 'N/A'}`));
    if (prices.spread !== null) {
      console.log(chalk.gray(`  Spread: $${prices.spread.toFixed(3)} | Mid: $${prices.midPrice?.toFixed(3)}`));
    }

    // Show depth
    if (orderbook.bids.length > 0 || orderbook.asks.length > 0) {
      console.log('\n' + chalk.bold('Depth (top 5):'));

      const depthTable = new Table({
        head: [chalk.green('Bids'), chalk.green('Size'), chalk.red('Asks'), chalk.red('Size')],
        colWidths: [12, 15, 12, 15]
      });

      const maxRows = 5;
      for (let i = 0; i < maxRows; i++) {
        const bid = orderbook.bids[i];
        const ask = orderbook.asks[i];
        depthTable.push([
          bid ? `$${bid[0].toFixed(3)}` : '',
          bid ? bid[1].toFixed(2) : '',
          ask ? `$${ask[0].toFixed(3)}` : '',
          ask ? ask[1].toFixed(2) : ''
        ]);
      }

      console.log(depthTable.toString());
    }
  } catch (error) {
    spinner.fail('Failed to fetch orderbook');
    console.error(error);
  }
}

async function displayPositions(): Promise<void> {
  const spinner = ora('Fetching positions...').start();

  try {
    const response = await api.getPositions();
    spinner.stop();

    if (response.data.length === 0) {
      console.log(chalk.yellow('\nNo positions found'));
      return;
    }

    const table = new Table({
      head: [
        chalk.cyan('Market'),
        chalk.cyan('Outcome'),
        chalk.cyan('Amount'),
        chalk.cyan('Value USD')
      ],
      colWidths: [40, 15, 20, 15]
    });

    response.data.forEach(p => {
      table.push([
        p.market.title.substring(0, 37) + (p.market.title.length > 37 ? '...' : ''),
        p.outcome.name,
        formatUnits(p.amount, 18),
        `$${parseFloat(p.valueUsd).toFixed(2)}`
      ]);
    });

    console.log('\n' + chalk.bold('Your Positions:'));
    console.log(table.toString());
  } catch (error) {
    spinner.fail('Failed to fetch positions');
    console.error(error);
  }
}

async function displayOrders(): Promise<void> {
  const spinner = ora('Fetching orders...').start();

  try {
    const response = await api.getOrders('OPEN');
    spinner.stop();

    if (response.data.length === 0) {
      console.log(chalk.yellow('\nNo open orders'));
      return;
    }

    const table = new Table({
      head: [
        chalk.cyan('ID'),
        chalk.cyan('Market'),
        chalk.cyan('Side'),
        chalk.cyan('Amount'),
        chalk.cyan('Status')
      ],
      colWidths: [20, 35, 10, 20, 12]
    });

    response.data.forEach(o => {
      table.push([
        o.id.substring(0, 17) + '...',
        `Market #${o.marketId}`,
        o.order.side === 0 ? chalk.green('BUY') : chalk.red('SELL'),
        formatUnits(o.amount, 18),
        o.status
      ]);
    });

    console.log('\n' + chalk.bold('Open Orders:'));
    console.log(table.toString());
  } catch (error) {
    spinner.fail('Failed to fetch orders');
    console.error(error);
  }
}

async function displayBalance(): Promise<void> {
  const spinner = ora('Fetching balance...').start();

  try {
    const balance = await tradingEngine.getBalance();
    spinner.stop();

    console.log('\n' + chalk.bold('Wallet Balance:'));
    console.log(`  Address: ${chalk.cyan(tradingEngine.getSignerAddress())}`);
    console.log(`  USDT: ${chalk.green(balance.formatted)} USDT`);
  } catch (error) {
    spinner.fail('Failed to fetch balance');
    console.error(error);
  }
}

async function placeTrade(): Promise<void> {
  try {
    // First, get OPEN categories
    const loadSpinner = ora('Fetching OPEN categories...').start();
    const catRes = await api.getCategories(50);
    loadSpinner.stop();

    const openCategories = catRes.data.filter(c => c.status === 'OPEN');

    if (openCategories.length === 0) {
      console.log(chalk.yellow('No open categories available'));
      return;
    }

    // Get all markets from OPEN categories
    const activeMarkets: Market[] = [];
    openCategories.forEach(cat => {
      cat.markets.forEach(m => {
        activeMarkets.push(m);
      });
    });

    if (activeMarkets.length === 0) {
      console.log(chalk.yellow('No active markets available'));
      return;
    }

    // Select category first
    const { categoryId } = await inquirer.prompt([
      {
        type: 'list',
        name: 'categoryId',
        message: 'Select category:',
        choices: openCategories.map(c => ({
          name: `[${c.id}] ${c.title} (${c.markets.length} markets)`,
          value: c.id
        })),
        pageSize: 15
      }
    ]);

    const selectedCategory = openCategories.find(c => c.id === categoryId)!;

    // Select market from category
    const { marketId } = await inquirer.prompt([
      {
        type: 'list',
        name: 'marketId',
        message: 'Select market:',
        choices: selectedCategory.markets.map(m => ({
          name: `[${m.id}] ${m.title.substring(0, 55)}`,
          value: m.id
        })),
        pageSize: 15
      }
    ]);

    const market = selectedCategory.markets.find(m => m.id === marketId)!;

    // Show orderbook
    await displayOrderbook(market.id);

    // Get order details
    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'side',
        message: 'Side:',
        choices: [
          { name: 'BUY', value: Side.BUY },
          { name: 'SELL', value: Side.SELL }
        ]
      },
      {
        type: 'list',
        name: 'outcomeIndex',
        message: 'Outcome:',
        choices: market.outcomes.map((o, i) => ({
          name: o.name,
          value: i
        }))
      },
      {
        type: 'list',
        name: 'orderType',
        message: 'Order type:',
        choices: [
          { name: 'LIMIT (set your price)', value: 'LIMIT' },
          { name: 'MARKET (execute immediately)', value: 'MARKET' }
        ]
      },
      {
        type: 'input',
        name: 'quantity',
        message: 'Quantity (shares):',
        validate: (v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0 ? true : 'Enter a valid number'
      },
      {
        type: 'input',
        name: 'price',
        message: 'Price per share (e.g., 0.45):',
        when: (ans) => ans.orderType === 'LIMIT',
        validate: (v) => {
          const n = parseFloat(v);
          return !isNaN(n) && n > 0 && n < 1 ? true : 'Price must be between 0 and 1';
        }
      }
    ]);

    // Confirm
    const total = answers.orderType === 'LIMIT'
      ? (parseFloat(answers.quantity) * parseFloat(answers.price)).toFixed(2)
      : 'varies (market order)';

    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Place ${answers.orderType} order for ${answers.quantity} shares @ $${answers.price || 'market'}? (Est. total: $${total})`,
        default: false
      }
    ]);

    if (!confirm) {
      console.log(chalk.yellow('Order cancelled'));
      return;
    }

    // Place order
    const spinner = ora('Placing order...').start();

    try {
      let hash: string;

      if (answers.orderType === 'LIMIT') {
        hash = await tradingEngine.createLimitOrder({
          market,
          side: answers.side,
          outcomeIndex: answers.outcomeIndex,
          pricePerShare: parseFloat(answers.price),
          quantity: parseFloat(answers.quantity)
        });
      } else {
        hash = await tradingEngine.createMarketOrder({
          market,
          side: answers.side,
          outcomeIndex: answers.outcomeIndex,
          quantity: parseFloat(answers.quantity)
        });
      }

      spinner.succeed(`Order placed! Hash: ${chalk.cyan(hash)}`);
    } catch (error) {
      spinner.fail('Failed to place order');
      throw error;
    }
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  }
}

async function cancelOrders(): Promise<void> {
  const spinner = ora('Fetching open orders...').start();

  try {
    const response = await api.getOrders('OPEN');
    spinner.stop();

    if (response.data.length === 0) {
      console.log(chalk.yellow('No open orders to cancel'));
      return;
    }

    const { orderIds } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'orderIds',
        message: 'Select orders to cancel:',
        choices: response.data.map(o => ({
          name: `[${o.id.substring(0, 8)}...] Market #${o.marketId} | ${o.order.side === 0 ? 'BUY' : 'SELL'} | ${formatUnits(o.amount, 18)} shares`,
          value: o.id
        }))
      }
    ]);

    if (orderIds.length === 0) {
      console.log(chalk.yellow('No orders selected'));
      return;
    }

    const cancelSpinner = ora('Cancelling orders...').start();
    await tradingEngine.cancelOrders(orderIds);
    cancelSpinner.succeed('Orders cancelled!');
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  }
}

async function setApprovals(): Promise<void> {
  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: 'Set trading approvals? (Required once before trading)',
      default: true
    }
  ]);

  if (!confirm) return;

  const spinner = ora('Setting approvals...').start();

  try {
    await tradingEngine.setApprovals();
    spinner.succeed('Approvals set!');
  } catch (error) {
    spinner.fail('Failed to set approvals');
    console.error(error);
  }
}

async function mainMenu(): Promise<void> {
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: '📊  View Markets', value: 'markets' },
        { name: '📈  View Orderbook', value: 'orderbook' },
        { name: '💰  Check Balance', value: 'balance' },
        { name: '📋  My Positions', value: 'positions' },
        { name: '📝  My Orders', value: 'orders' },
        new inquirer.Separator(),
        { name: '🛒  Place Trade', value: 'trade' },
        { name: '❌  Cancel Orders', value: 'cancel' },
        { name: '✅  Set Approvals', value: 'approvals' },
        new inquirer.Separator(),
        { name: '🚪  Exit', value: 'exit' }
      ]
    }
  ]);

  switch (action) {
    case 'markets':
      await displayMarkets();
      break;
    case 'orderbook':
      const { marketId } = await inquirer.prompt([
        {
          type: 'input',
          name: 'marketId',
          message: 'Enter market ID:',
          validate: (v) => !isNaN(parseInt(v)) ? true : 'Enter a valid market ID'
        }
      ]);
      await displayOrderbook(parseInt(marketId));
      break;
    case 'balance':
      await displayBalance();
      break;
    case 'positions':
      await displayPositions();
      break;
    case 'orders':
      await displayOrders();
      break;
    case 'trade':
      await placeTrade();
      break;
    case 'cancel':
      await cancelOrders();
      break;
    case 'approvals':
      await setApprovals();
      break;
    case 'exit':
      console.log(chalk.cyan('\nGoodbye! Happy trading! 🚀\n'));
      process.exit(0);
  }

  // Return to menu
  console.log('');
  await mainMenu();
}

async function main(): Promise<void> {
  console.clear();
  console.log(LOGO);

  // Validate configuration
  validateConfig();

  console.log(chalk.gray(`Network: ${config.network}`));
  console.log(chalk.gray(`API: ${config.apiBaseUrl}\n`));

  // Initialize trading engine
  const spinner = ora('Initializing...').start();

  try {
    await tradingEngine.initialize();
    spinner.succeed('Ready to trade!');
  } catch (error) {
    spinner.fail('Initialization failed');
    console.error(error);
    process.exit(1);
  }

  console.log('');

  // Start menu loop
  await mainMenu();
}

// Run
main().catch(console.error);
