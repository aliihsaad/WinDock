using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Text.Json;
using WinDock.Tray;

internal static class Program
{
    private static int checks;
    private static void Check(bool value, string message) { checks++; if(!value)throw new Exception(message); }
    private static async Task Wait(Func<bool> test) { for(var i=0;i<100;i++) { if(test())return;await Task.Delay(50); } throw new Exception("Native files fixture timed out"); }
    private static IEnumerable<Control> All(Control parent) => parent.Controls.Cast<Control>().SelectMany(c=>new[]{c}.Concat(All(c)));
    [STAThread] private static int Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        // Ephemeral loopback fixture: no real desktop files, folders or pairing state.
        var probe=new TcpListener(IPAddress.Loopback,0);probe.Start();var port=((IPEndPoint)probe.LocalEndpoint).Port;probe.Stop();
        using var server=new HttpListener();server.Prefixes.Add($"http://127.0.0.1:{port}/");server.Start();
        var enabled=true;var cancelled=false;var opened=false;var badRequest=false;
        var worker=Task.Run(async()=> {
            while(server.IsListening) {
                HttpListenerContext context;try { context=await server.GetContextAsync(); } catch { break; }
                try {
                    var request=context.Request;badRequest|=request.Headers["x-windock-files"]!="local";
                    var path=request.Url!.AbsolutePath;
                    if(request.HttpMethod=="POST") {
                        using var body=JsonDocument.Parse(await new StreamReader(request.InputStream).ReadToEndAsync());
                        if(path.EndsWith("/settings"))enabled=body.RootElement.GetProperty("enabled").GetBoolean();
                        else if(path.EndsWith("/cancel"))cancelled=body.RootElement.GetProperty("id").GetString()==new string('a',32);
                        else if(path.EndsWith("/open"))opened=true;
                        else badRequest=true;
                    } else badRequest|=path!="/api/transfers/local";
                    var payload=JsonSerializer.SerializeToUtf8Bytes(new { enabled,destination="Synthetic Downloads/WinDock",batches=new[]{new { id=new string('a',32),files=new[]{new { id=new string('b',32),name="مرحبا photo.bin",size=65536,bytes=32768,status=cancelled?"cancelled":"sending" }}}} });
                    context.Response.ContentType="application/json";context.Response.ContentLength64=payload.Length;
                    await context.Response.OutputStream.WriteAsync(payload);context.Response.Close();
                } catch { context.Response.Abort(); }
            }
        });
        using var window=new TransferWindow(new Uri($"http://127.0.0.1:{port}/api/transfers/local")) { StartPosition=FormStartPosition.Manual,Location=new Point(-2500,-2500),ShowInTaskbar=false };
        Exception? failure=null;
        window.Shown+=async(_,_)=> {
            try {
                var list=All(window).OfType<ListView>().Single();var receive=All(window).OfType<CheckBox>().Single();
                await Wait(()=>list.Items.Count==1);
                Check(list.Items[0].Text=="مرحبا photo.bin","Unicode filename displayed");
                Check(list.Items[0].SubItems[2].Text=="32.0 KB / 64.0 KB","Progress uses bytes accurately");
                Check(receive.Checked,"Paired receiving setting loaded");
                using(var image=new Bitmap(window.Width,window.Height)) { window.DrawToBitmap(image,new Rectangle(Point.Empty,window.Size));if(args.Length>0)image.Save(args[0],System.Drawing.Imaging.ImageFormat.Png); }
                typeof(CheckBox).GetMethod("OnClick",BindingFlags.Instance|BindingFlags.NonPublic)!.Invoke(receive,new object[]{EventArgs.Empty});
                await Wait(()=>!enabled);Check(!enabled,"Disable receiving reaches the local host");
                await Task.Delay(150);list.Items[0].Selected=true;
                All(window).OfType<Button>().Single(b=>b.Text=="Cancel selected batch").PerformClick();
                await Wait(()=>cancelled);Check(cancelled,"Selected batch ID reaches cancellation");
                await Wait(()=>list.Items[0].SubItems[1].Text=="cancelled");Check(true,"Cancellation status refreshes");
                All(window).OfType<Button>().Single(b=>b.Text=="Open folder").PerformClick();
                await Wait(()=>opened);Check(opened,"Folder opening is an explicit local action");
                Check(!badRequest,"All requests use the local-control header and fixed endpoint");
            } catch(Exception error) { failure=error; }
            finally { window.Close(); }
        };
        Application.Run(window);server.Stop();worker.GetAwaiter().GetResult();
        if(failure!=null)throw failure;
        Console.WriteLine($"Native Files & Media passed ({checks} checks; synthetic host, no real files opened).");return 0;
    }
}
