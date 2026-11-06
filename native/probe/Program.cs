// An isolated off-screen test window. Never touches a user's existing apps.
using System.Text.Json;

internal sealed class ProbeWindow : Form
{
    protected override bool ShowWithoutActivation => true;
}

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length > 0 && args[0] == "--focus-debug-control")
            return FocusDebugControl.Run(args);
        if (args.Length < 1) return 0;
        ApplicationConfiguration.Initialize();
        using var form = new ProbeWindow
        {
            Text = "WinDock verification window",
            ShowInTaskbar = true,
            StartPosition = FormStartPosition.Manual,
            Location = new Point(-10000, -10000),
            Size = new Size(160, 80),
        };
        form.Shown += (_, _) => File.WriteAllText(args[0], JsonSerializer.Serialize(new
        {
            pid = Environment.ProcessId,
            arguments = args.Skip(1).ToArray(),
            handle = form.Handle.ToInt64(),
        }));
        form.FormClosed += (_, _) => File.WriteAllText(args[0] + ".closed", "closed");
        form.Activated += (_, _) => File.WriteAllText(args[0] + ".activated", "activated");
        // Bound the fixture's lifetime even if the verification runner crashes.
        using var timeout = new System.Windows.Forms.Timer { Interval = 30000 };
        timeout.Tick += (_, _) => form.Close();
        timeout.Start();
        Application.Run(form);
        return 0;
    }
}
