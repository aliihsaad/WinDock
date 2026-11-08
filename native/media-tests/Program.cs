using System.Windows.Media;
using System.Windows.Media.Imaging;
using WinDock;

var checks = 0;
void Check(bool ok, string name) { if (!ok) throw new Exception(name); checks++; }
byte[] Picture(int width, int height)
{
    var pixels = new byte[width * height * 3];
    for (var i = 0; i < pixels.Length; i++) pixels[i] = (byte)(i % 251);
    var encoder = new PngBitmapEncoder();
    encoder.Frames.Add(BitmapFrame.Create(BitmapSource.Create(width, height, 96, 96, PixelFormats.Bgr24, null, pixels, width * 3)));
    using var stream = new MemoryStream();
    encoder.Save(stream);
    return stream.ToArray();
}
Check(MediaArtwork.Read(null) is null, "missing artwork is optional");
Check(MediaArtwork.Encode([]) is null, "empty artwork falls back");
Check(MediaArtwork.Encode([1, 2, 3, 4]) is null, "invalid artwork falls back");
Check(MediaArtwork.Encode(new byte[4 * 1024 * 1024 + 1]) is null, "oversized source is rejected");
foreach (var (width, height) in new[] { (640, 640), (640, 360), (180, 480), (32, 32) })
{
    var source = Picture(width, height);
    var artwork = MediaArtwork.Encode(source);
    const string prefix = "data:image/jpeg;base64,";
    Check(artwork?.StartsWith(prefix) == true, "artwork is re-encoded as a JPEG data URL");
    var bytes = Convert.FromBase64String(artwork![prefix.Length..]);
    Check(bytes.Length <= MediaArtwork.MaxArtworkBytes, "output stays within the bridge/poll budget");
    using var stream = new MemoryStream(bytes);
    var image = BitmapFrame.Create(stream);
    Check(image.PixelWidth <= 160 && image.PixelHeight <= 160, "both thumbnail dimensions are bounded");
    Check(Math.Abs((double)image.PixelWidth / image.PixelHeight - (double)width / height) < .02, "landscape and portrait art keep their aspect ratio");
    Check(MediaArtwork.Encode(source) == artwork, "unchanged artwork is stable across polling");
}
Console.WriteLine($"MEDIA ARTWORK TESTS OK: {checks} assertions");
