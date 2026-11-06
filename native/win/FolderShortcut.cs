using System.Diagnostics;
using System.Text.Json;
using System.Windows.Forms;

namespace WinDock;

internal static class FolderShortcut
{
    private static string Validate(string value)
    {
        if (value.Length is < 3 or > 400 || !char.IsAsciiLetter(value[0]) ||
            value[1] != ':' || value[2] != '\\' ||
            value.Any(c => char.IsControl(c) || "\"<>|?*".Contains(c)) || value[2..].Contains(':'))
            throw new ArgumentException("Choose a local folder using its full drive path.");
        var path = Path.GetFullPath(value);
        if (!Directory.Exists(path)) throw new DirectoryNotFoundException("This folder is unavailable. Check its drive or add the folder again.");
        return path;
    }

    public static int Pick()
    {
        Application.EnableVisualStyles();
        using var owner = new Form
        {
            Text = "WinDock — choose a folder", StartPosition = FormStartPosition.CenterScreen,
            ClientSize = new System.Drawing.Size(400, 100), MaximizeBox = false, MinimizeBox = false,
        };
        owner.Controls.Add(new Label { Text = "Choose a folder to add to your WinDock dock.",
            Dock = DockStyle.Fill, TextAlign = System.Drawing.ContentAlignment.MiddleCenter });
        using var dialog = new FolderBrowserDialog
        {
            Description = "Choose a folder for your WinDock dock",
            UseDescriptionForTitle = true,
            AutoUpgradeEnabled = true,
            InitialDirectory = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            ShowNewFolderButton = false,
        };
        string? path = null;
        Exception? failure = null;
        owner.Shown += (_, _) => owner.BeginInvoke(() =>
        {
            try { if (dialog.ShowDialog(owner) == DialogResult.OK) path = Validate(dialog.SelectedPath); }
            catch (Exception error) { failure = error; }
            finally { owner.Close(); }
        });
        Application.Run(owner);
        if (failure is not null) throw failure;
        Console.WriteLine(JsonSerializer.Serialize(new { path }));
        return 0;
    }

    public static int Open(string value)
    {
        var path = Validate(value);
        // Shell opens this exact directory without interpreting a command line.
        // Explorer may reuse a process, so a null Process is not a launch failure.
        using var process = Process.Start(new ProcessStartInfo
        {
            FileName = path, UseShellExecute = true, Verb = "open", WorkingDirectory = path,
        });
        return 0;
    }
}
