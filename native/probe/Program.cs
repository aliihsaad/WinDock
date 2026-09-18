// An isolated off-screen test window. Never touches a user's existing apps.
using System.Text.Json;

internal sealed class ProbeWindow : Form
{
    protected override bool ShowWithoutActivation => true;
}

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Length < 1) return;
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
        // Bound the fixture's lifetime even if the verification runner crashes.
        using var timeout = new System.Windows.Forms.Timer { Interval = 30000 };
        timeout.Tick += (_, _) => form.Close();
        timeout.Start();
        Application.Run(form);
    }
}
