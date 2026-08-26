#!/usr/bin/env ts-node
/**
 * Analysis Dashboard - Displays market analysis and trading recommendations
 *
 * Usage:
 *   npm run analyze          # One-shot analysis of all markets
 *   npm run analyze -- --watch  # Continuous monitoring mode
 *   npm run analyze -- --top 5   # Show top 5 opportunities
 */

import chalk from 'chalk';
import Table from 'cli-table3';
import ora from 'ora';
import { config } from '../config';
import { DataCollector } from './collector';
import { AnalysisEngine } from './engine';
import { Recommendation, AnalysisReport } from './types';

const collector = new DataCollector(30);
const engine = new AnalysisEngine(collector);

function displayReport(report: AnalysisReport, topN: number = 10): void {
  console.clear();
  console.log(chalk.cyan.bold('\n╔══════════════════════════════════════════════════════════════╗'));
  console.log(chalk.cyan.bold('║') + chalk.white.bold('  PREDICT.FUN MARKET ANALYSIS') + '                              ' + chalk.cyan.bold('║'));
  console.log(chalk.cyan.bold('╚══════════════════════════════════════════════════════════════╝'));
  console.log(chalk.gray(`  Time: ${new Date(report.timestamp).toLocaleTimeString()}`));
  console.log(chalk.gray(`  Markets analyzed: ${report.analyzedMarkets}/${report.totalMarkets}`));
  console.log(chalk.gray(`  Active opportunities: ${report.topOpportunities.length}\n`));

  if (report.recommendations.length === 0) {
    console.log(chalk.yellow('  No analyzable markets found.\n'));
    return;
  }

  // Summary table
  const table = new Table({
    head: [
      chalk.cyan('#'),
      chalk.cyan('Market'),
      chalk.cyan('Action'),
      chalk.cyan('Conf'),
      chalk.cyan('Entry'),
      chalk.cyan('Size'),
      chalk.cyan('SL'),
      chalk.cyan('TP')
    ],
    colWidths: [4, 35, 10, 6, 7, 7, 6, 6],
    style: { head: [], border: [] }
  });

  const shown = report.recommendations.slice(0, topN);

  shown.forEach((rec, i) => {
    const actionColor = rec.action === 'HOLD' ? chalk.gray :
      rec.action.includes('BUY') ? chalk.green : chalk.red;
    const confColor = rec.confidence >= 70 ? chalk.green.bold :
      rec.confidence >= 50 ? chalk.yellow : chalk.gray;

    table.push([
      (i + 1).toString(),
      rec.title.length > 32 ? rec.title.substring(0, 29) + '...' : rec.title,
      actionColor(rec.action),
      confColor(`${rec.confidence}%`),
      rec.entryPrice ? `$${rec.entryPrice.toFixed(3)}` : '-',
      rec.suggestedSize ? `$${rec.suggestedSize}` : '-',
      rec.stopLoss ? rec.stopLoss.toFixed(3) : '-',
      rec.takeProfit ? rec.takeProfit.toFixed(3) : '-'
    ]);
  });

  console.log(table.toString());

  // Top opportunities detail
  if (report.topOpportunities.length > 0) {
    console.log(chalk.yellow.bold('\n  ★ TOP OPPORTUNITIES:\n'));

    report.topOpportunities.slice(0, 3).forEach(rec => {
      console.log(chalk.white.bold(`  ${rec.title}`));
      console.log(chalk.gray(`    ${rec.summary}`));
      rec.signals.forEach(sig => {
        const dirColor = sig.direction === 'BULLISH' ? chalk.green :
          sig.direction === 'BEARISH' ? chalk.red : chalk.gray;
        console.log(`      ${dirColor(sig.direction)} ${chalk.gray(sig.type)}: ${sig.reason}`);
      });
      console.log('');
    });
  }
}

async function oneShot(topN: number): Promise<void> {

  const spinner = ora('Collecting market data...').start();
  try {
    const report = await engine.analyzeAll();
    spinner.succeed(`Analyzed ${report.analyzedMarkets} markets`);
    displayReport(report, topN);
  } catch (err: any) {
    spinner.fail('Analysis failed');
    console.error(chalk.red(err.message));
  }
}

async function watchMode(topN: number, intervalSec: number): Promise<void> {

  console.log(chalk.cyan(`\n  Watch mode: refreshing every ${intervalSec}s. Press Ctrl+C to stop.\n`));

  while (true) {
    try {
      const report = await engine.analyzeAll();
      displayReport(report, topN);
      console.log(chalk.gray(`  Next refresh in ${intervalSec}s...`));
      await new Promise(r => setTimeout(r, intervalSec * 1000));
    } catch (err: any) {
      console.error(chalk.red(`  Error: ${err.message}`));
      await new Promise(r => setTimeout(r, intervalSec * 1000));
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const watchFlag = args.includes('--watch') || args.includes('-w');
  const topIdx = args.indexOf('--top');
  const topN = topIdx !== -1 && args[topIdx + 1] ? parseInt(args[topIdx + 1]) : 10;
  const intervalIdx = args.indexOf('--interval');
  const intervalSec = intervalIdx !== -1 && args[intervalIdx + 1] ? parseInt(args[intervalIdx + 1]) : 60;

  if (watchFlag) {
    await watchMode(topN, intervalSec);
  } else {
    await oneShot(topN);
  }
}

main().catch(err => {
  console.error(chalk.red('Error:', err.message || err));
  process.exit(1);
});





