// Windows tray host. Process callbacks are marshalled to the UI thread.
using System.Diagnostics;
using System.Text.RegularExpressions;
using System.Text.Json;
using System.Net.Http;

namespace WinDock.Tray;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        var smoke = args.Contains("--smoke-test");
        using var instance = new Mutex(true, smoke ? null : @"Local\WinDock.Tray", out var firstInstance);
        if (!firstInstance)
        {
            MessageBox.Show("WinDock is already running. Find its icon in the Windows system tray.",
                "WinDock", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }
        using var app = new TrayApp(smoke);
        Application.Run(app);
        return Environment.ExitCode;
    }
}

internal sealed partial class TrayApp : ApplicationContext
{
    private readonly Control _dispatcher = new();
    private readonly NotifyIcon _icon;
    private readonly Icon _trayImage;
    private readonly bool _smoke;
    private readonly System.Windows.Forms.Timer? _smokeTimer;
    private Process? _server;
    private bool _stopping;
    private string _endpoint = "starting…";
    private string _pin = "----";
    private string _lastError = "";
    private readonly HttpClient _captureHttp = new() { Timeout = TimeSpan.FromSeconds(35) };
    private readonly System.Windows.Forms.Timer _captureTimer = new() { Interval = 2000 };
    private ToolStripMenuItem _stopRecording = null!;
    private bool _checkingCapture;
    private bool _recording;
    private readonly HttpClient _updateHttp = new(new HttpClientHandler { AllowAutoRedirect = false })
        { Timeout = TimeSpan.FromSeconds(12), MaxResponseContentBufferSize = 64 * 1024 };
    private readonly CancellationTokenSource _shutdown = new();
    private readonly System.Windows.Forms.Timer _updateTimer = new() { Interval = 8000 };
    private ToolStripMenuItem _checkUpdates = null!, _downloadUpdate = null!;
    private bool _checkingUpdates, _startupCheckScheduled;
    private UpdateResult? _availableUpdate;
    private Uri? _balloonRelease;

    [GeneratedRegex(@"open:\s*(\S+)")] private static partial Regex EndpointLine();
    [GeneratedRegex(@"PIN:\s*(\d{4,8})")] private static partial Regex PinLine();

    public TrayApp(bool smoke)
    {
        _smoke = smoke;
        _ = _dispatcher.Handle;
        _trayImage = LoadTrayIcon();
        _icon = new NotifyIcon
        {
            Icon = _trayImage,
            Visible = !smoke,
            Text = "WinDock",
            ContextMenuStrip = new ContextMenuStrip(),
        };
        _icon.ContextMenuStrip.Items.Add("Show connection info", null, (_, _) => ShowInfo());
        _icon.ContextMenuStrip.Items.Add("Copy URL", null, (_, _) => CopyUrl());
        _stopRecording = new ToolStripMenuItem("Stop recording", null, async (_, _) => await StopRecording());
        _stopRecording.Enabled = false;
        _icon.ContextMenuStrip.Items.Add(_stopRecording);
        var captures = new ToolStripMenuItem("Open saved files");
        captures.DropDownItems.Add("Screenshots", null, (_, _) => OpenCaptures(false));
        captures.DropDownItems.Add("Recordings", null, (_, _) => OpenCaptures(true));
        captures.DropDownItems.Add("Signatures", null, (_, _) => OpenCaptures(false, true));
        _icon.ContextMenuStrip.Items.Add(captures);
        _icon.ContextMenuStrip.Items.Add(new ToolStripSeparator());
        _checkUpdates = new ToolStripMenuItem("Check for updates…", null, async (_, _) => await CheckUpdates(true));
        _downloadUpdate = new ToolStripMenuItem("Download update…", null, (_, _) => OpenRelease(_availableUpdate?.ReleasePage)) { Visible = false };
        _icon.ContextMenuStrip.Items.Add(_checkUpdates);
        _icon.ContextMenuStrip.Items.Add(_downloadUpdate);
        _icon.ContextMenuStrip.Items.Add("Quit WinDock", null, async (_, _) => { if (await StopRecording()) ExitThread(); });
        _icon.DoubleClick += (_, _) => ShowInfo();
        _icon.BalloonTipClicked += (_, _) => { if (_balloonRelease is { } page) OpenRelease(page); };
        _updateTimer.Tick += async (_, _) => { _updateTimer.Stop(); await CheckUpdates(false); };
        _captureTimer.Tick += async (_, _) => await CheckCapture();
        if (!smoke) _captureTimer.Start();

        if (smoke)
        {
            var deadline = DateTime.UtcNow.AddSeconds(20);
            _smokeTimer = new System.Windows.Forms.Timer { Interval = 200 };
            _smokeTimer.Tick += (_, _) =>
            {
                if (_pin != "----" && _endpoint.StartsWith("http://") && _server is { HasExited: false })
                {
                    Console.WriteLine("TRAY OK: server started, URL and PIN received");
                    ExitThread();
                }
                else if (DateTime.UtcNow >= deadline)
                {
                    Fail("Timed out waiting for the server banner.");
                }
            };
            _smokeTimer.Start();
        }
        StartServer();
    }

    private static Icon LoadTrayIcon()
    {
        using var stream = typeof(TrayApp).Assembly.GetManifestResourceStream("WinDock.Tray.WinDock.ico")
            ?? throw new InvalidOperationException("The WinDock tray icon is missing.");
        using var source = new Icon(stream, SystemInformation.SmallIconSize);
        return (Icon)source.Clone();
    }

    private void OnUi(Action action)
    {
        if (_stopping || _dispatcher.IsDisposed) return;
        try { _dispatcher.BeginInvoke(action); }
        catch (InvalidOperationException) { /* shutdown won the race */ }
    }

    private void StartServer()
    {
        var root = AppContext.BaseDirectory;
        var bundledNode = Path.Combine(root, "node.exe");
        var psi = new ProcessStartInfo
        {
            FileName = File.Exists(bundledNode) ? bundledNode : "node",
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            WorkingDirectory = root,
        };
        psi.ArgumentList.Add(Path.Combine(root, "server.js"));
        var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
        _server = proc;
        proc.OutputDataReceived += (_, e) => OnUi(() => ReadBanner(e.Data));
        proc.ErrorDataReceived += (_, e) => { if (e.Data is not null) OnUi(() => _lastError = e.Data); };
        proc.Exited += (_, _) => OnUi(() => Fail($"Server exited with code {proc.ExitCode}. {_lastError}"));
        try
        {
            proc.Start();
            proc.BeginOutputReadLine();
            proc.BeginErrorReadLine();
        }
        catch (Exception ex) { OnUi(() => Fail(ex.Message)); }
    }

    private void Fail(string message)
    {
        Environment.ExitCode = 1;
        if (_smoke) Console.Error.WriteLine($"TRAY FAILED: {message}");
        else MessageBox.Show($"WinDock could not run its server.\n\n{message}",
            "WinDock", MessageBoxButtons.OK, MessageBoxIcon.Error);
        ExitThread();
    }

    private void ReadBanner(string? line)
    {
        if (string.IsNullOrWhiteSpace(line)) return;
        var endpoint = EndpointLine().Match(line);
        if (endpoint.Success) _endpoint = endpoint.Groups[1].Value;
        var pin = PinLine().Match(line);
        if (!pin.Success) return;
        _pin = pin.Groups[1].Value;
        _icon.Text = "WinDock — running";
        if (!_smoke)
        {
            ShowBalloon("WinDock is running", $"{_endpoint}\nPIN {_pin}");
            if (!_startupCheckScheduled) { _startupCheckScheduled = true; _updateTimer.Start(); }
        }
    }

    private void ShowInfo() => MessageBox.Show(
        $"WinDock {UpdateChecker.InstalledVersion}\n\nOpen this address on your phone:\n\n{_endpoint}\n\nPairing PIN: {_pin}\n\nBoth devices must be on the same network.",
        "WinDock", MessageBoxButtons.OK, MessageBoxIcon.Information);

    private void ShowBalloon(string title, string text, Uri? release = null)
    {
        _balloonRelease = release;
        _icon.ShowBalloonTip(8000, title, text, ToolTipIcon.Info);
    }

    private async Task CheckUpdates(bool interactive)
    {
        if (interactive) _updateTimer.Stop();
        if (_checkingUpdates || _stopping) return;
        _checkingUpdates = true;
        _checkUpdates.Enabled = false;
        _checkUpdates.Text = "Checking for updates…";
        try
        {
            var result = await new UpdateChecker(_updateHttp, UpdateChecker.InstalledVersion).CheckAsync(_shutdown.Token);
            if (_stopping) return;
            if (result.Status != UpdateStatus.Failed)
            {
                _availableUpdate = result.Status == UpdateStatus.Available ? result : null;
                _downloadUpdate.Visible = _availableUpdate is not null;
                _downloadUpdate.Text = "Download WinDock " + result.Version + "…";
            }
            if (!result.ShouldNotify(interactive)) return;
            if (result.Status == UpdateStatus.Available)
            {
                if (!interactive) ShowBalloon("WinDock update available", $"Version {result.Version} is ready. Click to view the release and download it.", result.ReleasePage);
                else if (MessageBox.Show($"WinDock {result.Version} is available.\nYou have {UpdateChecker.InstalledVersion}.\n\nOpen the release page? Download the installer, quit WinDock, then run it. Your dock settings are kept.",
                    "WinDock update", MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes) OpenRelease(result.ReleasePage);
            }
            else MessageBox.Show(result.Status == UpdateStatus.Current
                ? $"You’re up to date.\nInstalled version: {UpdateChecker.InstalledVersion}"
                : "Couldn’t check for updates. Check your internet connection and try again. You can also find releases at github.com/aliihsaad/WinDock/releases.",
                "WinDock updates", MessageBoxButtons.OK, result.Status == UpdateStatus.Current ? MessageBoxIcon.Information : MessageBoxIcon.Warning);
        }
        finally
        {
            _checkingUpdates = false;
            if (!_stopping) { _checkUpdates.Enabled = true; _checkUpdates.Text = "Check for updates…"; }
        }
    }

    private static void OpenRelease(Uri? page)
    {
        if (page is null) return;
        try { Process.Start(new ProcessStartInfo(page.AbsoluteUri) { UseShellExecute = true }); }
        catch (Exception ex) { MessageBox.Show($"Couldn’t open your browser. Visit {page}\n\n{ex.Message}", "WinDock updates", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
    }

    private void CopyUrl()
    {
        if (_endpoint.StartsWith("http", StringComparison.OrdinalIgnoreCase)) Clipboard.SetText(_endpoint);
    }

    private Uri? CaptureEndpoint(string suffix = "") => Uri.TryCreate(_endpoint, UriKind.Absolute, out var endpoint)
        && endpoint.Scheme == "http" ? new Uri($"http://127.0.0.1:{endpoint.Port}/api/capture{suffix}") : null;

    private async Task CheckCapture()
    {
        if (_checkingCapture || _stopping || CaptureEndpoint() is not { } endpoint) return;
        _checkingCapture = true;
        try
        {
            var json = await _captureHttp.GetStringAsync(endpoint);
            if (_stopping) return;
            using var document = JsonDocument.Parse(json);
            var phase = document.RootElement.GetProperty("phase").GetString();
            var active = phase is "starting" or "recording" or "stopping";
            _stopRecording.Enabled = active && phase != "stopping";
            _icon.Text = active ? "WinDock — screen recording" : "WinDock — running";
            if (active && !_recording) ShowBalloon("Screen recording started", "Your main monitor is being recorded without audio. Right-click WinDock to stop.");
            _recording = active;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException) { }
        finally { _checkingCapture = false; }
    }
    private async Task<bool> StopRecording()
    {
        if (CaptureEndpoint("/stop") is not { } endpoint) return true;
        try
        {
            using var response = await _captureHttp.PostAsync(endpoint, new StringContent("{}", System.Text.Encoding.UTF8, "application/json"));
            response.EnsureSuccessStatusCode();
            await CheckCapture();
            return true;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            MessageBox.Show("Could not save the recording. Check the connection and try stopping again before quitting.", "WinDock", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return false;
        }
    }
    private static void OpenCaptures(bool video, bool signature = false)
    {
        var root = Environment.GetFolderPath(video ? Environment.SpecialFolder.MyVideos : Environment.SpecialFolder.MyPictures);
        if (string.IsNullOrEmpty(root)) root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), video ? "Videos" : "Pictures");
        var folder = signature ? Path.Combine(root, "WinDock", "Signatures") : Path.Combine(root, "WinDock");
        try { Directory.CreateDirectory(folder); Process.Start(new ProcessStartInfo(folder) { UseShellExecute = true }); }
        catch (Exception ex) { MessageBox.Show(ex.Message, "WinDock captures", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing && !_stopping)
        {
            _stopping = true;
            _updateTimer.Dispose();
            _shutdown.Cancel();
            _updateHttp.Dispose();
            _shutdown.Dispose();
            _captureTimer.Dispose();
            _captureHttp.Dispose();
            _smokeTimer?.Dispose();
            _icon.Visible = false;
            _icon.ContextMenuStrip?.Dispose();
            _icon.Dispose();
            _trayImage.Dispose();
            try
            {
                if (_server is { HasExited: false })
                {
                    _server.Kill(entireProcessTree: true);
                    _server.WaitForExit(5000);
                }
            }
            catch (InvalidOperationException) { /* never started or already exited */ }
            _server?.Dispose();
            _dispatcher.Dispose();
        }
        base.Dispose(disposing);
    }
}
