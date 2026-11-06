using System.Diagnostics;
using System.Net.Http;
using System.Text;
using System.Text.Json;

namespace WinDock.Tray;

internal sealed class TransferWindow : Form
{
    private readonly Uri endpoint;
    private readonly HttpClient http = new(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(8), MaxResponseContentBufferSize = 256 * 1024 };
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 1000 };
    private readonly CheckBox enabled = new() { Text = "Allow securely paired phones to send files", AutoSize = true };
    private readonly TextBox folder = new() { ReadOnly = true, Dock = DockStyle.Fill };
    private readonly Label status = new() { Text = "Connecting…", AutoSize = true, MaximumSize = new Size(660,0) };
    private readonly ListView files = new() { View = View.Details, FullRowSelect = true, Dock = DockStyle.Fill };
    private bool refreshing, updating;
    public TransferWindow(Uri localEndpoint)
    {
        endpoint = localEndpoint;
        Text = "WinDock — Files & Media"; Size = new Size(740,500); MinimumSize = new Size(560,360); StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(16,29,39); ForeColor = Color.FromArgb(235,246,246); Font = new Font("Segoe UI",10);
        var panel = new TableLayoutPanel { Dock=DockStyle.Fill, Padding=new Padding(18), ColumnCount=1, RowCount=5 };
        panel.RowStyles.Add(new RowStyle(SizeType.AutoSize)); panel.RowStyles.Add(new RowStyle(SizeType.AutoSize)); panel.RowStyles.Add(new RowStyle(SizeType.AutoSize)); panel.RowStyles.Add(new RowStyle(SizeType.Percent,100)); panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        panel.Controls.Add(new Label { Text="Files & Media",UseMnemonic=false,AutoSize=true,Font=new Font(Font.FontFamily,20,FontStyle.Bold),Margin=new Padding(0,0,0,12) });
        panel.Controls.Add(enabled);
        var choices = new TableLayoutPanel { AutoSize=true,Dock=DockStyle.Fill,ColumnCount=3,Padding=new Padding(0,12,0,12) };
        choices.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100)); choices.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize)); choices.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        var choose=new Button { Text="Choose folder…",AutoSize=true }; var open=new Button { Text="Open folder",AutoSize=true };
        choices.Controls.Add(folder); choices.Controls.Add(choose); choices.Controls.Add(open); panel.Controls.Add(choices);
        files.Columns.Add("File",300); files.Columns.Add("Status",135); files.Columns.Add("Received",140); files.BackColor=BackColor; files.ForeColor=ForeColor; panel.Controls.Add(files);
        var footer=new FlowLayoutPanel { AutoSize=true,Dock=DockStyle.Fill };
        var cancel=new Button { Text="Cancel selected batch",AutoSize=true };
        cancel.Click += async (_,_) => { if(files.SelectedItems.Count==0)return; try { using var response=await Request("/cancel",new { id=(files.SelectedItems[0].Tag as string)?.Split('/')[0] }); response.EnsureSuccessStatusCode(); await RefreshFiles(); } catch { status.Text="Could not cancel. Check the host; completed files are kept."; } };
        footer.Controls.Add(cancel); footer.Controls.Add(status); panel.Controls.Add(footer); Controls.Add(panel);
        enabled.Click += async (_,_) => await Configure(new { enabled=enabled.Checked });
        choose.Click += async (_,_) => { using var picker=new FolderBrowserDialog { Description="Choose where WinDock receives files",UseDescriptionForTitle=true,SelectedPath=folder.Text }; if(picker.ShowDialog(this)==DialogResult.OK)await Configure(new { destination=picker.SelectedPath }); };
        open.Click += async (_,_) => { try { using var response=await Request("/open",new { }); response.EnsureSuccessStatusCode(); } catch { status.Text="Could not open the receive folder. Check the host and folder permissions."; } };
        timer.Tick += async (_,_) => await RefreshFiles(); Shown += async (_,_) => { timer.Start(); await RefreshFiles(); };
    }
    private async Task<HttpResponseMessage> Request(string suffix="",object? body=null)
    {
        var request=new HttpRequestMessage(body is null?HttpMethod.Get:HttpMethod.Post,new Uri(endpoint.AbsoluteUri+suffix));
        request.Headers.Add("x-windock-files","local");
        if(body is not null)request.Content=new StringContent(JsonSerializer.Serialize(body),Encoding.UTF8,"application/json");
        using(request)return await http.SendAsync(request);
    }
    private async Task Configure(object value)
    {
        if(updating)return; updating=true;
        try { using var response=await Request("/settings",value); using var doc=JsonDocument.Parse(await response.Content.ReadAsStringAsync()); if(!IsDisposed)status.Text=response.IsSuccessStatusCode?"Receive settings saved.":doc.RootElement.GetProperty("error").GetString(); }
        catch { if(!IsDisposed)status.Text="Receive settings could not be saved. Check that WinDock is running."; }
        finally { updating=false; if(!IsDisposed)await RefreshFiles(); }
    }
    private async Task RefreshFiles()
    {
        if(refreshing||updating||IsDisposed)return; refreshing=true;
        try {
            using var response=await Request(); response.EnsureSuccessStatusCode(); using var doc=JsonDocument.Parse(await response.Content.ReadAsStringAsync()); if(IsDisposed)return;
            var root=doc.RootElement; enabled.Checked=root.GetProperty("enabled").GetBoolean(); folder.Text=root.GetProperty("destination").GetString();
            var selected=files.SelectedItems.Count>0?files.SelectedItems[0].Tag as string:null;
            files.BeginUpdate(); files.Items.Clear();
            foreach(var batch in root.GetProperty("batches").EnumerateArray().Reverse())foreach(var file in batch.GetProperty("files").EnumerateArray()) {
                var tag=batch.GetProperty("id").GetString()+"/"+file.GetProperty("id").GetString();
                var item=new ListViewItem(file.TryGetProperty("savedName",out var saved)?saved.GetString():file.GetProperty("name").GetString()) { Tag=tag,Selected=tag==selected }; item.SubItems.Add(file.GetProperty("status").GetString());
                var bytes=file.GetProperty("bytes").GetInt64(); var total=file.GetProperty("size"); item.SubItems.Add(FormatSize(bytes)+(total.ValueKind==JsonValueKind.Number?$" / {FormatSize(total.GetInt64())}":"")); files.Items.Add(item);
            }
            files.EndUpdate(); if(status.Text=="Connecting…")status.Text="Files are never opened automatically. Cancel from your phone; disabling receiving stops pending transfers.";
        } catch { if(!IsDisposed)status.Text="Waiting for the WinDock host…"; }
        finally { refreshing=false; }
    }
    private static string FormatSize(long value) => value>=1073741824?$"{value/1073741824d:0.0} GB":value>=1048576?$"{value/1048576d:0.0} MB":value>=1024?$"{value/1024d:0.0} KB":$"{value} B";
    protected override void Dispose(bool disposing) { if(disposing){timer.Dispose();http.Dispose();}base.Dispose(disposing); }
}
