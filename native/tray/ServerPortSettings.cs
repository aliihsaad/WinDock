using System.Diagnostics;
using System.Globalization;
using System.Text.Json;

namespace WinDock.Tray;

internal sealed record ServerPortSettings(int? Port)
{
    internal static string SettingsPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "windock", "server-port.json");

    internal static ServerPortSettings? Load(string path)
    {
        if (!File.Exists(path)) return null; // Preserve existing PORT installations until the user saves a choice.
        var settings = JsonSerializer.Deserialize<ServerPortSettings>(File.ReadAllText(path))
            ?? throw new InvalidDataException("The saved server port settings are empty.");
        settings.Validate();
        return settings;
    }

    private void Validate()
    {
        if (Port is < 1 or > 65535) throw new InvalidDataException("The server port must be between 1 and 65535.");
    }

    internal void Apply(ProcessStartInfo startInfo)
    {
        Validate();
        if (Port is { } port) startInfo.Environment["PORT"] = port.ToString(CultureInfo.InvariantCulture);
        else startInfo.Environment.Remove("PORT");
    }

    internal void Save(string path)
    {
        Validate();
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            File.WriteAllText(temporary, JsonSerializer.Serialize(this));
            File.Move(temporary, path, overwrite: true);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
}
