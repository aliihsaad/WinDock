// WinDockTray — the host's system-tray front end.
//
// It supervises `node server.js`, surfaces the pairing PIN and LAN URL, and
// gives the user a visible, one-click way to stop the dock. It deliberately
// runs asInvoker (see app.manifest): the dock launches apps into the user's own
// session, and an elevated host could not do that correctly.

using System.Diagnostics;
using System.Text.RegularExpressions;

namespace WinDock.Tray;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        using var app = new TrayApp();
        Application.Run();
    }
}

internal sealed partial class TrayApp : IDisposable
{
    private readonly NotifyIcon _icon;
    private readonly Process _server;
    private string _endpoint = "starting…";
    private string _pin = "----";

    [GeneratedRegex(@"open:\s*(\S+)")] private static partial Regex EndpointLine();
    [GeneratedRegex(@"PIN:\s*(\d{4})")] private static partial Regex PinLine();

    public TrayApp()
    {
        _icon = new NotifyIcon
        {
            Icon = SystemIcons.Application,
            Visible = true,
            Text = "WinDock",
            ContextMenuStrip = new ContextMenuStrip(),
        };

        _icon.ContextMenuStrip.Items.Add("Show connection info", null, (_, _) => ShowInfo());
        _icon.ContextMenuStrip.Items.Add("Copy URL", null, (_, _) => CopyUrl());
        _icon.ContextMenuStrip.Items.Add(new ToolStripSeparator());
        _icon.ContextMenuStrip.Items.Add("Quit WinDock", null, (_, _) => Quit());
        _icon.DoubleClick += (_, _) => ShowInfo();

        _server = StartServer();
    }

    private Process StartServer()
    {
        var root = AppContext.BaseDirectory;
        var psi = new ProcessStartInfo
        {
            FileName = "node",
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            WorkingDirectory = root,
        };
        psi.ArgumentList.Add(Path.Combine(root, "server.js"));

        var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
        proc.OutputDataReceived += (_, e) => ReadBanner(e.Data);
        proc.Exited += (_, _) => OnServerExited(proc.ExitCode);

        try
        {
            proc.Start();
            proc.BeginOutputReadLine();
            proc.BeginErrorReadLine();
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                $"WinDock could not start its server.\n\n{ex.Message}\n\nIs Node.js installed and on PATH?",
                "WinDock", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Application.Exit();
        }

        return proc;
    }

    /// <summary>Parse the host's startup banner for the URL and PIN.</summary>
    private void ReadBanner(string? line)
    {
        if (string.IsNullOrWhiteSpace(line)) return;

        var endpoint = EndpointLine().Match(line);
        if (endpoint.Success) _endpoint = endpoint.Groups[1].Value;

        var pin = PinLine().Match(line);
        if (pin.Success)
        {
            _pin = pin.Groups[1].Value;
            _icon.Text = $"WinDock — {_endpoint}";
            _icon.ShowBalloonTip(5000, "WinDock is running", $"{_endpoint}\nPIN {_pin}", ToolTipIcon.Info);
        }
    }

    private void OnServerExited(int code)
    {
        if (code == 0) return;
        _icon.ShowBalloonTip(5000, "WinDock stopped",
            $"The dock server exited with code {code}.", ToolTipIcon.Error);
    }

    private void ShowInfo() =>
        MessageBox.Show(
            $"Open this address on your phone:\n\n{_endpoint}\n\nPairing PIN: {_pin}\n\n" +
            "Both devices must be on the same network.",
            "WinDock", MessageBoxButtons.OK, MessageBoxIcon.Information);

    private void CopyUrl()
    {
        if (_endpoint.StartsWith("http", StringComparison.OrdinalIgnoreCase)) Clipboard.SetText(_endpoint);
    }

    private void Quit()
    {
        Dispose();
        Application.Exit();
    }

    public void Dispose()
    {
        _icon.Visible = false;
        _icon.Dispose();

        try
        {
            if (!_server.HasExited)
            {
                // Kill the whole tree: the server owns no children today, but a
                // stray node process surviving the tray would keep the port bound.
                _server.Kill(entireProcessTree: true);
                _server.WaitForExit(5000);
            }
        }
        catch (InvalidOperationException) { /* already gone */ }
        _server.Dispose();
    }
}
