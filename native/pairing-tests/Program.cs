using System.Net;
using System.Net.Http;
using System.Text.Json.Nodes;
using WinDock.Tray;

internal static class Program
{
    private static int _checks;
    private static void Check(bool value, string message) { _checks++; if (!value) throw new Exception(message); }
    private static void Reject(Action action, string message)
    {
        var rejected = false;
        try { action(); } catch (Exception ex) when (ex is ArgumentException or InvalidDataException or FormatException or System.Text.Json.JsonException or KeyNotFoundException) { rejected = true; }
        Check(rejected, message);
    }
    [STAThread]
    private static int Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        var fixture = JsonNode.Parse(File.ReadAllText(args[0]))!.AsObject();
        string Response(double seconds = 120) { fixture["expires"] = DateTimeOffset.UtcNow.AddSeconds(seconds).ToUnixTimeMilliseconds(); return fixture.ToJsonString(); }
        var page = new Uri("http://127.0.0.1:18624/pair");
        Check(PairingClient.IsLocalPairPage(page), "Loopback pairing page accepted");
        foreach (var url in new[] { "http://192.168.1.2/pair", "https://127.0.0.1/pair", "http://localhost/pair", "http://127.0.0.1/pair?x=1", "http://127.0.0.1/pair#x", "http://user@127.0.0.1/pair", "http://127.0.0.1/elsewhere" })
            Reject(() => new PairingClient(new Uri(url)), "Non-canonical local endpoints rejected");
        using (var parsed = PairingCode.Parse(Response()))
        {
            Check(parsed.Invitation == fixture["invitation"]!.GetValue<string>(), "Invitation survives bitmap conversion unchanged");
            Check(parsed.Image.Width == parsed.Image.Height, "Square bitmap decoded");
        }
        foreach (var mutation in new Action<JsonObject>[] {
            j => j["image"] = "https://attacker.invalid/code.gif",
            j => j["image"] = "data:image/gif;base64,not-base64",
            j => j["invitation"] = "https://attacker.invalid",
            j => j["expires"] = DateTimeOffset.UtcNow.AddDays(1).ToUnixTimeMilliseconds(),
            j => j["image"] = "data:image/gif;base64," + new string('A', 70000),
            j => j.Remove("image") })
        {
            var value = JsonNode.Parse(Response())!.AsObject(); mutation(value);
            Reject(() => PairingCode.Parse(value.ToJsonString()), "Malformed or unbounded payload rejected");
        }
        var huge = JsonNode.Parse(Response())!.AsObject();
        var header = Convert.FromBase64String(huge["image"]!.GetValue<string>().Split(',')[1]);
        header[6] = 255; header[7] = 255; huge["image"] = "data:image/gif;base64," + Convert.ToBase64String(header);
        Reject(() => PairingCode.Parse(huge.ToJsonString()), "Huge GIF dimensions rejected before decode");
        var calls = 0; var pendingCancelled = false;
        var handler = new TestHandler(async (request, cancellation) =>
        {
            calls++;
            Check(request.RequestUri == new Uri(page, "/api/pairing/invite") && request.Method == HttpMethod.Post, "Native client uses the local invitation endpoint");
            Check(request.Headers.GetValues("X-WinDock-Pair").Single() == "local", "Explicit local action header sent");
            Check(await request.Content!.ReadAsStringAsync(cancellation) == "{\"format\":\"gif\"}", "Only the additive image option is sent");
            if (calls == 3 && !args.Contains("--preview"))
            {
                try { await Task.Delay(10000, cancellation); }
                catch (OperationCanceledException) { pendingCancelled = true; throw; }
            }
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(Response(calls == 1 && !args.Contains("--preview") ? 2 : 120)) };
        });
        var toolsOpened = false;
        using var window = new PairingWindow(new PairingClient(page, handler), () => toolsOpened = true);
        if (!args.Contains("--preview")) { window.StartPosition = FormStartPosition.Manual; window.Location = new Point(-2500, -2500); window.ShowInTaskbar = false; }
        Exception? failure = null;
        window.Shown += async (_, _) =>
        {
            if (args.Contains("--preview")) return;
            try
            {
                var copy = (Button)window.Controls.Find("CopyPairingText", true).Single();
                var refresh = (Button)window.Controls.Find("RefreshCode", true).Single();
                await Wait(() => copy.Enabled);
                Check(calls == 1, "Opening the window creates one code");
                Check(!toolsOpened && window.Controls.Find("ConnectionTools", true).Length == 1, "Existing management tools remain available without opening a browser automatically");
                using (var bitmap = new Bitmap(window.Width, window.Height))
                {
                    window.DrawToBitmap(bitmap, new Rectangle(Point.Empty, window.Size));
                    bitmap.Save(args[1], System.Drawing.Imaging.ImageFormat.Png);
                }
                await Wait(() => !copy.Enabled, 5000);
                Check(!copy.Enabled, "Expiration clears the code and disables copying");
                refresh.PerformClick(); await Wait(() => copy.Enabled);
                Check(calls == 2, "User can refresh an expired code");
                refresh.PerformClick(); window.Close();
            }
            catch (Exception ex) { failure = ex; window.Close(); }
        };
        Application.Run(window);
        if (failure is not null) throw failure;
        if (!args.Contains("--preview"))
        {
            SpinWait.SpinUntil(() => pendingCancelled, 1000);
            Check(pendingCancelled, "Closing the window cancels the pending local request");
            Console.WriteLine($"native pairing verification passed ({_checks} checks)");
        }
        return 0;
    }
    private static async Task Wait(Func<bool> condition, int timeout = 3000)
    {
        var until = Environment.TickCount64 + timeout;
        while (!condition()) { if (Environment.TickCount64 >= until) throw new Exception("Native pairing UI timed out"); await Task.Delay(30); }
    }
    private sealed class TestHandler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => respond(request, cancellationToken);
    }
}
