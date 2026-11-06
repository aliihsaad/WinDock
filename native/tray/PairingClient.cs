using System.Buffers.Binary;
using System.Net.Http;
using System.Text;
using System.Text.Json;

namespace WinDock.Tray;

internal sealed class PairingCode : IDisposable
{
    public string Invitation { get; }
    public DateTimeOffset Expires { get; }
    public Bitmap Image { get; }

    private PairingCode(string invitation, DateTimeOffset expires, Bitmap image)
        => (Invitation, Expires, Image) = (invitation, expires, image);

    public static PairingCode Parse(string json)
    {
        if (json.Length > 128 * 1024) throw new InvalidDataException("Pairing response is too large.");
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        var invitation = root.GetProperty("invitation").GetString() ?? "";
        var image = root.GetProperty("image").GetString() ?? "";
        var expires = DateTimeOffset.FromUnixTimeMilliseconds(root.GetProperty("expires").GetInt64());
        const string prefix = "data:image/gif;base64,";
        if (!invitation.StartsWith("windock-pair:", StringComparison.Ordinal) || invitation.Length is < 20 or > 8192 ||
            !image.StartsWith(prefix, StringComparison.Ordinal) || image.Length > 64 * 1024 ||
            expires > DateTimeOffset.UtcNow.AddMinutes(3))
            throw new InvalidDataException("Invalid pairing response.");
        var bytes = Convert.FromBase64String(image[prefix.Length..]);
        if (bytes.Length < 10 || (Encoding.ASCII.GetString(bytes, 0, 6) is not ("GIF87a" or "GIF89a")))
            throw new InvalidDataException("Invalid pairing image.");
        // One pixel per QR module, including its four-module quiet zone.
        // Bound dimensions before asking the image decoder to allocate memory.
        var width = BinaryPrimitives.ReadUInt16LittleEndian(bytes.AsSpan(6, 2));
        var height = BinaryPrimitives.ReadUInt16LittleEndian(bytes.AsSpan(8, 2));
        if (width != height || width is < 29 or > 185 || (width - 29) % 4 != 0)
            throw new InvalidDataException("Invalid pairing image size.");
        using var stream = new MemoryStream(bytes);
        using var source = System.Drawing.Image.FromStream(stream, false, true);
        return new PairingCode(invitation, expires, new Bitmap(source));
    }

    public void Dispose() => Image.Dispose();
}

internal sealed class PairingClient : IDisposable
{
    private readonly Uri _endpoint;
    private readonly HttpClient _http;

    public static bool IsLocalPairPage(Uri? uri) => uri is { IsAbsoluteUri: true } &&
        uri.Scheme == "http" && uri.Host == "127.0.0.1" && uri.AbsolutePath == "/pair" &&
        uri.UserInfo.Length == 0 && uri.Query.Length == 0 && uri.Fragment.Length == 0;

    public PairingClient(Uri pairPage, HttpMessageHandler? handler = null)
    {
        if (!IsLocalPairPage(pairPage)) throw new ArgumentException("Pairing requires the local companion.", nameof(pairPage));
        _endpoint = new Uri(pairPage, "/api/pairing/invite");
        _http = new HttpClient(handler ?? new HttpClientHandler { AllowAutoRedirect = false, UseProxy = false })
            { Timeout = TimeSpan.FromSeconds(8), MaxResponseContentBufferSize = 128 * 1024 };
    }

    public async Task<PairingCode> CreateAsync(CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, _endpoint);
        request.Headers.Add("X-WinDock-Pair", "local");
        request.Content = new StringContent("{\"format\":\"gif\"}", Encoding.UTF8, "application/json");
        using var response = await _http.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
        return PairingCode.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
    }

    public void Dispose() => _http.Dispose();
}
