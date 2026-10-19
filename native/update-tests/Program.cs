using System.Net;
using System.Text.Json;
using WinDock.Tray;

var checks = 0;
void Check(bool ok, string message) { checks++; if (!ok) throw new Exception(message); }
string Manifest(string version, string? url = null) => JsonSerializer.Serialize(new {
    version, available = true,
    windows = new { url = url ?? $"https://github.com/aliihsaad/WinDock/releases/download/v{version}/WinDockSetup.exe" },
});
int Compare(string a, string b) => ReleaseVersion.Parse(a).CompareTo(ReleaseVersion.Parse(b));
Check(Compare("0.2.2-preview.1", "0.2.1-preview.1") > 0, "new patch is newer");
Check(Compare("0.2.1-preview.10", "0.2.1-preview.2") > 0, "numeric preview comparison");
Check(Compare("0.2.1", "0.2.1-preview.9") > 0, "stable supersedes preview");
Check(Compare("0.2.1-preview.1", "0.2.1-preview.1") == 0, "same version is not an update");
Check(Compare("0.2.1-alpha", "0.2.1-beta") < 0, "preview identifiers compare ordinally");
Check(Compare("0.2.1-1", "0.2.1--1") < 0, "hyphenated identifier is not numeric");
Check(Compare("0.2.1-preview", "0.2.1-preview.1") < 0, "shorter preview sorts earlier");
foreach (var invalid in new[] { "", "v0.2.1", "0.2", "01.2.1", "0.2.1-preview.01", "0.2.1\n", "0.2.1/evil", "999999999999.0.0" }) {
    try { ReleaseVersion.Parse(invalid); throw new Exception("Accepted invalid version: " + invalid); }
    catch (FormatException) { checks++; }
}
var newer = UpdateChecker.ParseManifest(Manifest("0.2.2-preview.1"), "0.2.1-preview.1");
Check(newer.Status == UpdateStatus.Available, "new release found");
Check(newer.ReleasePage?.AbsoluteUri == "https://github.com/aliihsaad/WinDock/releases/tag/v0.2.2-preview.1", "opens canonical release page");
Check(newer.ShouldNotify(false), "startup notifies about a newer release");
foreach (var version in new[] { "0.2.0-preview.1", "0.2.1-preview.1" }) {
    var current = UpdateChecker.ParseManifest(Manifest(version), "0.2.1-preview.1");
    Check(current.Status == UpdateStatus.Current && !current.ShouldNotify(false), "startup stays quiet without a newer release");
    Check(current.ShouldNotify(true), "manual check reports up-to-date status");
}
foreach (var invalid in new[] { "{}", "[]", "{\"available\":false}", Manifest("0.2.2", "https://evil.test/installer.exe"), Manifest("0.2.2", "https://github.com/other/repo/releases/download/v0.2.2/WinDockSetup.exe") }) {
    try { UpdateChecker.ParseManifest(invalid, "0.2.1-preview.1"); throw new Exception("Accepted unsafe manifest"); }
    catch (InvalidDataException) { checks++; }
}
string body = Manifest("0.2.2-preview.1");
var handler = new FixtureHandler(request => {
    Check(request.RequestUri?.AbsoluteUri == UpdateChecker.ManifestUrl, "checks the fixed HTTPS feed");
    Check(request.Headers.CacheControl?.NoCache == true, "requests fresh metadata");
    Check(request.Headers.UserAgent.ToString() == "WinDock/0.2.1-preview.1", "identifies installed release");
    return new(HttpStatusCode.OK) { Content = new StringContent(body) };
});
using var http = new HttpClient(handler) { MaxResponseContentBufferSize = 64 * 1024 };
var checker = new UpdateChecker(http, "0.2.1-preview.1");
Check((await checker.CheckAsync()).Status == UpdateStatus.Available, "HTTP response reaches update result");
body = "not JSON";
var failed = await checker.CheckAsync();
Check(failed.Status == UpdateStatus.Failed && !failed.ShouldNotify(false), "malformed/offline startup is quiet");
Check(failed.ShouldNotify(true), "manual failure is actionable");
body = new string('x', 65537);
Check((await checker.CheckAsync()).Status == UpdateStatus.Failed, "oversized feed is rejected");
using var offline = new HttpClient(new FixtureHandler(_ => throw new HttpRequestException("Offline")));
Check((await new UpdateChecker(offline, "0.2.1-preview.1").CheckAsync()).Status == UpdateStatus.Failed, "network errors are handled");
using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
Check((await checker.CheckAsync(cancelled.Token)).Status == UpdateStatus.Failed, "shutdown cancellation is handled");
if (args.Contains("--live")) {
    using var live = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(12), MaxResponseContentBufferSize = 65536 };
    var current = await new UpdateChecker(live, "0.2.2-preview.1").CheckAsync();
    Check(current.Status == UpdateStatus.Current, "published feed recognizes current release");
    var upgrade = await new UpdateChecker(live, "0.2.1-preview.1").CheckAsync();
    Check(upgrade.Status == UpdateStatus.Available && upgrade.Version == "0.2.2-preview.1", "published feed notifies an older installation");
}
Console.WriteLine($"{checks} update checks passed");

sealed class FixtureHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler {
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) {
        token.ThrowIfCancellationRequested();
        return Task.FromResult(respond(request));
    }
}
