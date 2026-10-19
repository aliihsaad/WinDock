using System.Net.Http;
using System.Numerics;
using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace WinDock.Tray;

internal sealed record ReleaseVersion(int Major, int Minor, int Patch, string[] Preview, string Text) : IComparable<ReleaseVersion>
{
    public static ReleaseVersion Parse(string text)
    {
        if (text.Length > 100) throw new FormatException("Invalid release version.");
        var match = Regex.Match(text, @"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?\z", RegexOptions.CultureInvariant);
        if (!match.Success || !int.TryParse(match.Groups[1].Value, out var major)
            || !int.TryParse(match.Groups[2].Value, out var minor) || !int.TryParse(match.Groups[3].Value, out var patch))
            throw new FormatException("Invalid release version.");
        var preview = match.Groups[4].Success ? match.Groups[4].Value.Split('.') : Array.Empty<string>();
        if (preview.Any(part => part.Length > 1 && part[0] == '0' && part.All(char.IsAsciiDigit)))
            throw new FormatException("Invalid preview version.");
        return new(major, minor, patch, preview, text);
    }

    public int CompareTo(ReleaseVersion? other)
    {
        if (other is null) return 1;
        foreach (var pair in new[] { (Major, other.Major), (Minor, other.Minor), (Patch, other.Patch) })
            if (pair.Item1 != pair.Item2) return pair.Item1.CompareTo(pair.Item2);
        if (Preview.Length == 0 || other.Preview.Length == 0)
            return (Preview.Length == 0).CompareTo(other.Preview.Length == 0);
        for (var i = 0; i < Math.Min(Preview.Length, other.Preview.Length); i++)
        {
            var left = BigInteger.Zero; var right = BigInteger.Zero;
            var leftNumber = Preview[i].All(char.IsAsciiDigit) && BigInteger.TryParse(Preview[i], out left);
            var rightNumber = other.Preview[i].All(char.IsAsciiDigit) && BigInteger.TryParse(other.Preview[i], out right);
            var order = leftNumber && rightNumber ? left.CompareTo(right)
                : leftNumber != rightNumber ? (leftNumber ? -1 : 1)
                : string.CompareOrdinal(Preview[i], other.Preview[i]);
            if (order != 0) return order;
        }
        return Preview.Length.CompareTo(other.Preview.Length);
    }
}

internal enum UpdateStatus { Current, Available, Failed }
internal sealed record UpdateResult(UpdateStatus Status, string? Version = null, Uri? ReleasePage = null)
{
    public bool ShouldNotify(bool interactive) => interactive || Status == UpdateStatus.Available;
}

internal sealed class UpdateChecker(HttpClient http, string installedVersion)
{
    internal const string ManifestUrl = "https://windock.vercel.app/downloads.json";
    internal const string ReleasesUrl = "https://github.com/aliihsaad/WinDock/releases";
    internal static string InstalledVersion => (typeof(UpdateChecker).Assembly
        .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
        ?? "0.2.2-preview.1").Split('+')[0];

    public async Task<UpdateResult> CheckAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, ManifestUrl);
            request.Headers.UserAgent.ParseAdd("WinDock/" + installedVersion);
            request.Headers.CacheControl = new() { NoCache = true };
            using var response = await http.SendAsync(request, cancellationToken);
            response.EnsureSuccessStatusCode();
            var json = await response.Content.ReadAsStringAsync(cancellationToken);
            return ParseManifest(json, installedVersion);
        }
        catch (Exception ex) when (ex is HttpRequestException or OperationCanceledException or JsonException or FormatException or InvalidDataException)
        {
            return new(UpdateStatus.Failed);
        }
    }

    internal static UpdateResult ParseManifest(string json, string installedVersion)
    {
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object
            || !root.TryGetProperty("available", out var available) || available.ValueKind != JsonValueKind.True
            || !root.TryGetProperty("version", out var version) || version.ValueKind != JsonValueKind.String
            || !root.TryGetProperty("windows", out var windows) || windows.ValueKind != JsonValueKind.Object
            || !windows.TryGetProperty("url", out var url) || url.ValueKind != JsonValueKind.String)
            throw new InvalidDataException("No published Windows update information.");
        var latest = ReleaseVersion.Parse(version.GetString()!);
        // The feed can only announce this repository's tagged Windows installer.
        var releasePage = ReleasesUrl + "/tag/v" + latest.Text;
        if (url.GetString() != ReleasesUrl + "/download/v" + latest.Text + "/WinDockSetup.exe")
            throw new InvalidDataException("Unexpected download location.");
        return latest.CompareTo(ReleaseVersion.Parse(installedVersion)) > 0
            ? new(UpdateStatus.Available, latest.Text, new Uri(releasePage))
            : new(UpdateStatus.Current, latest.Text);
    }
}
