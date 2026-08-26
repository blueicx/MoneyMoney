using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Drawing;
using System.Threading;
using System.Windows.Forms;

namespace MoneyMoney
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            bool createdNew;
            using (var mutex = new Mutex(true, @"Local\MoneyMoneyTrayClient", out createdNew))
            {
                if (!createdNew)
                {
                    TrayApplicationContext.RequestOpenDashboard();
                    return;
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                using (var app = new TrayApplicationContext())
                {
                    Application.Run(app);
                }
            }
        }
    }

    internal sealed class TrayApplicationContext : ApplicationContext
    {
        private const string DashboardUrl = "http://127.0.0.1:3000/";
        private const string HealthUrl = "http://127.0.0.1:3000/api/health";
        private const string OpenSignalName = @"Local\MoneyMoneyDashboardOpen";
        private readonly NotifyIcon trayIcon;
        private readonly ToolStripMenuItem statusItem;
        private Process backendProcess;
        private bool ownsBackend;
        private int ensureDashboardRunning;
        private EventWaitHandle openSignal;
        private Thread openSignalThread;
        private bool disposed;

        public static void RequestOpenDashboard()
        {
            try
            {
                using (var signal = EventWaitHandle.OpenExisting(OpenSignalName))
                {
                    signal.Set();
                }
            }
            catch
            {
            }
        }

        public TrayApplicationContext()
        {
            statusItem = new ToolStripMenuItem("正在启动…")
            {
                Enabled = false
            };

            var menu = new ContextMenuStrip();
            menu.Items.Add("打开面板", null, delegate { RestartBackendAndOpenDashboard(); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(statusItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("退出", null, delegate { ExitApplication(); });

            trayIcon = new NotifyIcon
            {
                Icon = CreateTrayIcon(),
                Text = "MoneyMoney",
                Visible = true,
                ContextMenuStrip = menu
            };
            trayIcon.DoubleClick += delegate { RestartBackendAndOpenDashboard(); };

            var worker = new Thread(EnsureDashboardSafe) { IsBackground = true };
            worker.Start();

            openSignal = new EventWaitHandle(true, EventResetMode.AutoReset, OpenSignalName);
            openSignalThread = new Thread(WaitForOpenSignals) { IsBackground = true };
            openSignalThread.Start();
        }

        private static Icon CreateTrayIcon()
        {
            try
            {
                using (var stream = typeof(Program).Assembly.GetManifestResourceStream("MoneyMoney.app.ico"))
                {
                    if (stream != null) return new Icon(stream);
                }

                return Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application;
            }
            catch
            {
                return SystemIcons.Application;
            }
        }

        private static string GetConfigValue(string key)
        {
            try
            {
                var configPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "MoneyMoney.ini");
                if (!File.Exists(configPath)) return null;

                foreach (var line in File.ReadAllLines(configPath))
                {
                    var trimmed = line.Trim();
                    if (trimmed.StartsWith(key + "=", StringComparison.OrdinalIgnoreCase))
                        return trimmed.Substring(key.Length + 1).Trim();
                }
            }
            catch
            {
            }
            return null;
        }

        private static string FindBackend()
        {
            var configured = GetConfigValue("path");
            if (!string.IsNullOrEmpty(configured) && File.Exists(configured)) return configured;

            var environment = Environment.GetEnvironmentVariable("MONEYMONEY_CORE");
            if (!string.IsNullOrEmpty(environment) && File.Exists(environment)) return environment;

            var core = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "core", "MoneyMoneyCore.exe");
            if (File.Exists(core)) return core;

            var local = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "MoneyMoneyCore.exe");
            if (File.Exists(local)) return local;

            var release = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "release", "MoneyMoneyCore.exe");
            if (File.Exists(release)) return release;

            return null;
        }

        private static string GetWorkingDirectory(string backend)
        {
            var configured = GetConfigValue("workdir");
            if (!string.IsNullOrEmpty(configured) && Directory.Exists(configured)) return configured;

            var dir = Path.GetDirectoryName(backend);
            return string.IsNullOrEmpty(dir) ? AppDomain.CurrentDomain.BaseDirectory : dir;
        }

        private static bool IsServerAlive()
        {
            try
            {
                var request = (HttpWebRequest)WebRequest.Create(HealthUrl);
                request.Method = "GET";
                request.Timeout = 700;
                request.ReadWriteTimeout = 700;
                using (var response = (HttpWebResponse)request.GetResponse())
                {
                    return (int)response.StatusCode < 500;
                }
            }
            catch
            {
                return false;
            }
        }

        public static void OpenDashboard()
        {
            try
            {
                if (IsDashboardWindowVisible()) return;

                var edge = FindEdgeBrowser();
                if (!string.IsNullOrEmpty(edge))
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = edge,
                        Arguments = "--app=" + DashboardUrl + " --window-size=1280,920",
                        UseShellExecute = false,
                        CreateNoWindow = true
                    });
                    return;
                }

                Process.Start(new ProcessStartInfo(DashboardUrl)
                {
                    UseShellExecute = true
                });
            }
            catch
            {
            }
        }

        private static string[] CandidateEdgePaths()
        {
            return new[]
            {
                Environment.ExpandEnvironmentVariables("%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe"),
                Environment.ExpandEnvironmentVariables("%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe")
            };
        }

        private static string FindEdgeBrowser()
        {
            try
            {
                foreach (var path in CandidateEdgePaths())
                {
                    if (File.Exists(path)) return path;
                }
            }
            catch
            {
            }
            return null;
        }

        private static bool IsDashboardWindowVisible()
        {
            try
            {
                foreach (var process in Process.GetProcesses())
                {
                    if (process == null) continue;
                    var title = process.MainWindowTitle;
                    if (!string.IsNullOrWhiteSpace(title) &&
                        title.IndexOf("MoneyMoney", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        return true;
                    }
                }
            }
            catch
            {
            }
            return false;
        }

        private void WaitForOpenSignals()
        {
            while (!disposed)
            {
                try
                {
                    if (openSignal == null || !openSignal.WaitOne(1000)) continue;
                    // A click can arrive after the backend has crashed. Reopening the
                    // browser alone is not enough; revive the backend first.
                    if (IsServerAlive())
                    {
                        if (!IsDashboardWindowVisible()) OpenDashboard();
                    }
                    else
                    {
                        EnsureDashboardSafe();
                    }
                }
                catch
                {
                }
            }
        }

        private void EnsureDashboardSafe()
        {
            if (Interlocked.CompareExchange(ref ensureDashboardRunning, 1, 0) != 0) return;
            try
            {
                EnsureDashboard();
            }
            catch
            {
                SetStatus("启动失败");
            }
            finally
            {
                Interlocked.Exchange(ref ensureDashboardRunning, 0);
            }
        }

        private void RestartBackendAndOpenDashboard()
        {
            var worker = new Thread(() =>
            {
                if (IsServerAlive()) OpenDashboard();
                else EnsureDashboardSafe();
            })
            {
                IsBackground = true
            };
            worker.Start();
        }

        private void SetStatus(string message)
        {
            var strip = trayIcon.ContextMenuStrip;
            if (strip == null || !strip.IsHandleCreated)
            {
                statusItem.Text = message;
                return;
            }

            strip.BeginInvoke((MethodInvoker)delegate
            {
                statusItem.Text = message;
            });
        }

        private void EnsureDashboard()
        {
            if (IsServerAlive())
            {
                SetStatus("面板运行中");
                OpenDashboard();
                return;
            }

            var backend = FindBackend();
            if (string.IsNullOrEmpty(backend))
            {
                SetStatus("未找到 MoneyMoneyCore.exe");
                MessageBox.Show("未找到 MoneyMoney 核心程序。请把 MoneyMoney.exe 和 MoneyMoneyCore.exe 放在同一文件夹，或在 MoneyMoney.ini 中设置 path。", "MoneyMoney");
                return;
            }

            try
            {
                var info = new ProcessStartInfo
                {
                    FileName = backend,
                    WorkingDirectory = GetWorkingDirectory(backend),
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                // The tray is responsible for opening exactly one dashboard window.
                info.EnvironmentVariables["MONEYMONEY_NO_BROWSER"] = "1";
                backendProcess = Process.Start(info);
                ownsBackend = true;
            }
            catch (Exception ex)
            {
                SetStatus("启动失败");
                MessageBox.Show("无法启动核心程序：\n" + ex.Message, "MoneyMoney");
                return;
            }

            for (var i = 0; i < 40; i++)
            {
                if (IsServerAlive())
                {
                    SetStatus("面板运行中");
                    OpenDashboard();
                    return;
                }
                if (backendProcess != null && backendProcess.HasExited)
                {
                    SetStatus("核心程序已退出");
                    return;
                }
                Thread.Sleep(250);
            }

            SetStatus("启动超时，请稍后重试");
        }

        protected override void Dispose(bool disposing)
        {
            if (disposed) return;
            disposed = true;

            if (disposing)
            {
                if (openSignalThread != null && openSignalThread.IsAlive)
                {
                    openSignalThread.Join(1500);
                }

                if (openSignal != null)
                {
                    openSignal.Dispose();
                    openSignal = null;
                }

                if (trayIcon != null)
                {
                    trayIcon.Visible = false;
                    trayIcon.Dispose();
                }

                if (backendProcess != null && ownsBackend && !backendProcess.HasExited)
                {
                    try
                    {
                        backendProcess.Kill();
                        backendProcess.WaitForExit(3000);
                    }
                    catch
                    {
                    }
                }

                if (backendProcess != null)
                {
                    backendProcess.Dispose();
                    backendProcess = null;
                }
            }
        }

        public new void Dispose()
        {
            Dispose(true);
            GC.SuppressFinalize(this);
        }

        private void ExitApplication()
        {
            Dispose();
            Application.Exit();
        }
    }
}
