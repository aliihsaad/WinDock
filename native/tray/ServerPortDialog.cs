namespace WinDock.Tray;

internal static class ServerPortDialog
{
    internal static bool Show(string? settingsPath = null)
    {
        settingsPath ??= ServerPortSettings.SettingsPath;
        ServerPortSettings? saved = null;
        string? loadError = null;
        try { saved = ServerPortSettings.Load(settingsPath); }
        catch (Exception ex) when (ex is IOException or InvalidDataException or UnauthorizedAccessException or System.Text.Json.JsonException)
        { loadError = ex.Message; }
        var inherited = Environment.GetEnvironmentVariable("PORT");
        var selectedPort = saved?.Port;
        if (saved is null && int.TryParse(inherited, out var environmentPort) && environmentPort is >= 1 and <= 65535)
            selectedPort = environmentPort;

        using var form = new Form { Text = "WinDock — Server port", AutoScaleMode = AutoScaleMode.Dpi,
            ClientSize = new Size(510, 325), FormBorderStyle = FormBorderStyle.FixedDialog,
            StartPosition = FormStartPosition.CenterScreen, MinimizeBox = false, MaximizeBox = false };
        var panel = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(24), ColumnCount = 1, RowCount = 5 };
        var description = new Label { AutoSize = true, MaximumSize = new Size(455, 0), Margin = new Padding(0, 0, 0, 16),
            Text = "Automatic tries port 8620, then uses an available port if needed. A custom port stays fixed. Reconnect your phone after changing ports." };
        var automatic = new RadioButton { Text = "Automatic (recommended)", AutoSize = true, Checked = selectedPort is null };
        var fixedPort = new RadioButton { Text = "Use a custom port", AutoSize = true, Checked = selectedPort is not null };
        var number = new NumericUpDown { Minimum = 1, Maximum = 65535, Value = selectedPort ?? 8620, Width = 120,
            Enabled = selectedPort is not null, Margin = new Padding(24, 4, 0, 12) };
        fixedPort.CheckedChanged += (_, _) => number.Enabled = fixedPort.Checked;
        var details = new Label { AutoSize = true, MaximumSize = new Size(455, 0),
            Text = loadError is not null ? "Saved settings could not be read. Saving will replace them."
                : saved is null && !string.IsNullOrWhiteSpace(inherited)
                    ? "A PORT environment setting is present. Saving here overrides it for WinDock."
                    : "This choice is saved for your Windows account." };
        var options = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.TopDown, WrapContents = false, Dock = DockStyle.Fill };
        options.Controls.Add(automatic); options.Controls.Add(fixedPort); options.Controls.Add(number);
        var buttons = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.RightToLeft, Dock = DockStyle.Fill };
        var cancel = new Button { Text = "Cancel", AutoSize = true, DialogResult = DialogResult.Cancel };
        var save = new Button { Text = "Save", AutoSize = true };
        save.Click += (_, _) => {
            try
            {
                new ServerPortSettings(automatic.Checked ? null : (int)number.Value).Save(settingsPath);
                form.DialogResult = DialogResult.OK;
            }
            catch (Exception ex) when (ex is IOException or InvalidDataException or UnauthorizedAccessException)
            { MessageBox.Show("Could not save the port setting.\n\n" + ex.Message, "WinDock", MessageBoxButtons.OK, MessageBoxIcon.Error); }
        };
        buttons.Controls.Add(cancel); buttons.Controls.Add(save);
        panel.Controls.Add(description); panel.Controls.Add(options); panel.Controls.Add(details); panel.Controls.Add(buttons);
        form.Controls.Add(panel); form.AcceptButton = save; form.CancelButton = cancel;
        return form.ShowDialog() == DialogResult.OK;
    }
}
