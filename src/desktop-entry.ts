import { exec } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { get as httpGet } from 'http';

const dashboardUrl = 'http://127.0.0.1:3000';
const lockFile = path.join(os.tmpdir(), 'moneymoney-dashboard.lock');
const openLockFile = path.join(os.tmpdir(), 'moneymoney-dashboard-open.lock');
const OPEN_DEBOUNCE_MS = 15_000;

function openDashboard(): boolean {
  if (process.env.MONEYMONEY_NO_BROWSER === '1' || !acquireOpenLock()) return false;

  const command = process.platform === 'win32'
    ? `start "" "${dashboardUrl}"`
    : process.platform === 'darwin'
      ? `open "${dashboardUrl}"`
      : `xdg-open "${dashboardUrl}"`;

  exec(command, { windowsHide: true });
  return true;
}

function acquireOpenLock(): boolean {
  try {
    if (fs.existsSync(openLockFile)) {
      const raw = fs.readFileSync(openLockFile, 'utf8').trim();
      const openedAt = Number.parseInt(raw, 10);
      if (!Number.isFinite(openedAt) || Date.now() - openedAt >= OPEN_DEBOUNCE_MS) {
        fs.unlinkSync(openLockFile);
      } else {
        return false;
      }
    }

    const handle = fs.openSync(openLockFile, 'wx');
    fs.writeFileSync(handle, String(Date.now()));
    fs.closeSync(handle);
    return true;
  } catch {
    return false;
  }
}

function isDashboardRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const request = httpGet(`${dashboardUrl}/api/health`, (response) => {
      response.resume();
      resolve(response.statusCode != null && response.statusCode < 500);
    });

    request.once('error', () => resolve(false));
    request.setTimeout(800, () => {
      request.destroy();
      resolve(false);
    });
  });
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return error?.code === 'EPERM';
  }
}

function acquireStartupLock(): boolean {
  try {
    if (fs.existsSync(lockFile)) {
      const raw = fs.readFileSync(lockFile, 'utf8').trim();
      const pid = Number.parseInt(raw, 10);
      if (!Number.isFinite(pid) || !isProcessAlive(pid)) fs.unlinkSync(lockFile);
    }

    const handle = fs.openSync(lockFile, 'wx');
    fs.writeFileSync(handle, String(process.pid));
    fs.closeSync(handle);
    return true;
  } catch {
    return false;
  }
}

function releaseStartupLock(): void {
  try {
    const raw = fs.readFileSync(lockFile, 'utf8').trim();
    if (raw === String(process.pid)) fs.unlinkSync(lockFile);
  } catch {
  }
}

async function waitForDashboard(timeoutMs = 12000): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isDashboardRunning()) return true;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return false;
}

async function bootstrap(): Promise<void> {
  if (await isDashboardRunning()) {
    console.log('\n  💰 MoneyMoney dashboard is already running.');
    if (openDashboard()) {
      console.log('  Opening the existing dashboard...\n');
    } else {
      console.log(`  Existing dashboard: ${dashboardUrl}\n`);
    }
    return;
  }

  if (acquireStartupLock()) {
    process.once('exit', releaseStartupLock);

    // The web server registers its own lifecycle handlers and keeps Node alive.
    require('./web/server');
    // Open as soon as the health endpoint responds instead of waiting for a
    // fixed delay; cold starts often become visible in under one second.
    void waitForDashboard(8000).then(() => {
      if (openDashboard()) {
        console.log('\n  Browser opened at http://localhost:3000');
      } else {
        console.log('\n  Dashboard ready at http://localhost:3000');
        console.log('  Browser opening was handled by the desktop launcher.');
      }
      console.log('  Keep this window running while you use the dashboard.\n');
    });
    return;
  }

  // Another launcher owns startup. Do not spawn a second backend.
  if (await waitForDashboard()) {
    openDashboard();
  } else {
    console.error('\n  MoneyMoney is still starting. Please try again in a moment.\n');
    process.exitCode = 1;
  }
}

void bootstrap();
