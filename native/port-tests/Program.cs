using System.Diagnostics;
using WinDock.Tray;

var checks = 0;
void Check(bool ok, string message) { checks++; if (!ok) throw new Exception(message); }
void Reject(Action action, string message)
{
    var rejected = false;
    try { action(); }
    catch (Exception ex) when (ex is IOException or InvalidDataException or System.Text.Json.JsonException) { rejected = true; }
    Check(rejected, message);
}
var directory = Path.Combine(Path.GetTempPath(), "windock-port-tests-" + Guid.NewGuid().ToString("N"));
var path = Path.Combine(directory, "server-port.json");
try
{
    var inherited = new ProcessStartInfo();
    inherited.Environment["PORT"] = "18720";
    Check(ServerPortSettings.Load(path) is null, "No saved file preserves the existing environment choice");
    ServerPortSettings.Load(path)?.Apply(inherited);
    Check(inherited.Environment["PORT"] == "18720", "Existing PORT workaround survives upgrade");

    new ServerPortSettings(24000).Save(path);
    var restored = ServerPortSettings.Load(path)!;
    var parentPort = Environment.GetEnvironmentVariable("PORT");
    restored.Apply(inherited);
    Check(inherited.Environment["PORT"] == "24000", "Saved custom port survives restart and overrides inherited PORT");
    Check(Environment.GetEnvironmentVariable("PORT") == parentPort, "Applying settings does not mutate the parent environment");

    new ServerPortSettings(null).Save(path);
    ServerPortSettings.Load(path)!.Apply(inherited);
    Check(!inherited.Environment.ContainsKey("PORT"), "Saved automatic mode overrides an old PORT workaround");
    Check(Directory.GetFiles(directory).Length == 1, "Atomic save leaves only the settings file");

    foreach (var port in new[] { 1, 65535 })
    {
        new ServerPortSettings(port).Save(path);
        Check(ServerPortSettings.Load(path)!.Port == port, "Valid port boundary round-trips");
    }
    foreach (var port in new[] { 0, -1, 65536 })
    {
        Reject(() => new ServerPortSettings(port).Save(path), "Invalid ports cannot replace saved settings");
        Check(ServerPortSettings.Load(path)!.Port == 65535, "Invalid save preserves the previous choice");
        File.WriteAllText(path, "{\"Port\":" + port + "}");
        Reject(() => ServerPortSettings.Load(path), "Invalid persisted ports fail visibly");
        new ServerPortSettings(65535).Save(path);
    }
    foreach (var content in new[] { "not json", "null", "{\"Port\":\"18720\"}" })
    {
        File.WriteAllText(path, content);
        Reject(() => ServerPortSettings.Load(path), "Corrupt settings are not silently ignored");
    }
    new ServerPortSettings(null).Save(path);
    Check(ServerPortSettings.Load(path)!.Port is null, "Saving automatic mode recovers corrupt settings");
}
finally { if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true); }
Console.WriteLine($"{checks} assertions\nserver port settings verification passed");
