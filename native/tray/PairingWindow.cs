using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;

namespace WinDock.Tray;

internal sealed class PairingWindow : Form
{
    private readonly PairingClient _client;
    private readonly CancellationTokenSource _closed = new();
    private readonly System.Windows.Forms.Timer _expiry = new() { Interval = 1000 };
    private readonly QrView _qr = new() { Dock = DockStyle.Fill, Margin = new Padding(0, 16, 0, 16), AccessibleName = "Phone pairing QR code" };
    private readonly Label _status = new() { AutoSize = true, Dock = DockStyle.Fill, Margin = new Padding(0, 0, 0, 14), AccessibleName = "Pairing status" };
    private readonly Button _refresh = new() { Text = "Show a new code", AutoSize = true, Padding = new Padding(8, 4, 8, 4), Name = "RefreshCode" };
    private readonly Button _copy = new() { Text = "Copy pairing text", AutoSize = true, Padding = new Padding(8, 4, 8, 4), Enabled = false, Name = "CopyPairingText" };
    private PairingCode? _code;
    private bool _loading;
    private bool _closing;
    private readonly Font _headingFont;

    public PairingWindow(PairingClient client, Action? openConnectionTools = null)
    {
        _client = client;
        Text = "Pair your phone · WinDock";
        AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = new Size(520, 650);
        MinimumSize = new Size(440, 580);
        StartPosition = FormStartPosition.CenterScreen;
        MaximizeBox = false;
        _headingFont = new Font(SystemFonts.MessageBoxFont!.FontFamily, 18, FontStyle.Bold);
        var panel = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(24), ColumnCount = 1, RowCount = 6 };
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        for (var row = 0; row < 6; row++) panel.RowStyles.Add(new RowStyle(row == 2 ? SizeType.Percent : SizeType.AutoSize, row == 2 ? 100 : 0));
        panel.Controls.Add(new Label { Text = "Pair your phone", AutoSize = true, Font = _headingFont, Margin = new Padding(0, 0, 0, 10) }, 0, 0);
        panel.Controls.Add(new Label { Text = "Open WinDock on your phone and choose Scan computer code.\nUse the same Wi-Fi network, or connect with USB tethering.", AutoSize = true, Dock = DockStyle.Fill, Margin = Padding.Empty }, 0, 1);
        panel.Controls.Add(_qr, 0, 2);
        panel.Controls.Add(_status, 0, 3);
        var actions = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, Margin = Padding.Empty, WrapContents = true };
        actions.Controls.Add(_refresh); actions.Controls.Add(_copy);
        panel.Controls.Add(actions, 0, 4);
        var footer = new TableLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, ColumnCount = 2, Margin = new Padding(0, 14, 0, 0) };
        footer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        footer.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        if (openConnectionTools is not null)
        {
            var tools = new LinkLabel { Text = "Connection help and paired phones…", AutoSize = true, Anchor = AnchorStyles.Left, Name = "ConnectionTools" };
            tools.LinkClicked += (_, _) => openConnectionTools(); footer.Controls.Add(tools, 0, 0);
        }
        var close = new Button { Text = "Close", AutoSize = true, Anchor = AnchorStyles.Right, DialogResult = DialogResult.Cancel };
        close.Click += (_, _) => Close(); footer.Controls.Add(close, 1, 0); panel.Controls.Add(footer, 0, 5); CancelButton = close;
        Controls.Add(panel);
        Shown += async (_, _) => await RefreshCodeAsync();
        _refresh.Click += async (_, _) => await RefreshCodeAsync();
        _copy.Click += (_, _) => CopyPairingText();
        _expiry.Tick += (_, _) => UpdateExpiry();
        _expiry.Start();
    }

    private void ClearCode()
    {
        _qr.Image = null;
        _code?.Dispose(); _code = null; _copy.Enabled = false;
    }

    private async Task RefreshCodeAsync()
    {
        if (_loading || _closing) return;
        _loading = true; _refresh.Enabled = false; _copy.Text = "Copy pairing text"; ClearCode();
        _status.Text = "Preparing a secure pairing code…";
        try
        {
            var code = await _client.CreateAsync(_closed.Token);
            if (_closing) { code.Dispose(); return; }
            _code = code; _qr.Image = code.Image; _copy.Enabled = true;
            UpdateExpiry();
        }
        catch (OperationCanceledException) when (_closing) { }
        catch (Exception ex) when (ex is System.Net.Http.HttpRequestException or OperationCanceledException or
            System.Text.Json.JsonException or InvalidDataException or FormatException or ArgumentException or
            InvalidOperationException or KeyNotFoundException or ExternalException)
        {
            if (!_closing)
                _status.Text = "Couldn't create a pairing code. Check that WinDock is running, then try again.";
        }
        finally
        {
            _loading = false;
            if (!_closing) _refresh.Enabled = true;
        }
    }

    private void UpdateExpiry()
    {
        if (_code is null) return;
        var remaining = (int)Math.Ceiling((_code.Expires - DateTimeOffset.UtcNow).TotalSeconds);
        if (remaining <= 0) { ClearCode(); _status.Text = "Code expired. Show a new code to continue."; return; }
        _status.Text = $"Expires in {remaining / 60}:{remaining % 60:00} · Can pair one phone.\nPair once; WinDock remembers your computer.";
    }

    private void CopyPairingText()
    {
        UpdateExpiry();
        if (_code is null) return;
        try
        {
            // Explicit user action only; the code is never copied automatically.
            Clipboard.SetText(_code.Invitation);
            _copy.Text = "Copied";
        }
        catch (ExternalException) { _status.Text = "Clipboard is busy. Try Copy pairing text again."; }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing && !_closing)
        {
            _closing = true;
            _closed.Cancel(); _expiry.Dispose(); ClearCode(); _client.Dispose();
            _closed.Dispose(); _headingFont.Dispose();
        }
        base.Dispose(disposing);
    }

    private sealed class QrView : Control
    {
        private Bitmap? _image;
        public Bitmap? Image { get => _image; set { _image = value; Invalidate(); } }
        public QrView() { DoubleBuffered = true; BackColor = Color.White; SetStyle(ControlStyles.ResizeRedraw, true); }
        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.Clear(Color.White);
            if (_image is not { } image) return;
            var scale = Math.Min(ClientSize.Width, ClientSize.Height) / image.Width;
            if (scale < 1) return;
            var size = image.Width * scale;
            e.Graphics.InterpolationMode = InterpolationMode.NearestNeighbor;
            e.Graphics.PixelOffsetMode = PixelOffsetMode.Half;
            e.Graphics.DrawImage(image, new Rectangle((Width - size) / 2, (Height - size) / 2, size, size),
                0, 0, image.Width, image.Height, GraphicsUnit.Pixel);
        }
    }
}
