using System.Windows.Media.Imaging;
using Windows.Storage.Streams;

namespace WinDock;

internal static class MediaArtwork
{
    private const int MaxSourceBytes = 4 * 1024 * 1024;
    internal const int MaxArtworkBytes = 96 * 1024;

    // Artwork is optional: a missing, slow or invalid thumbnail must not hide the track.
    public static string? Read(IRandomAccessStreamReference? reference)
    {
        if (reference is null) return null;
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(3));
        var token = timeout.Token;
        try
        {
            return Task.Run(async () =>
            {
                using var source = await reference.OpenReadAsync().AsTask(token).ConfigureAwait(false);
                if (source.Size is 0 or > MaxSourceBytes) return null;
                using var input = source.AsStreamForRead();
                var bytes = new byte[(int)source.Size];
                await input.ReadExactlyAsync(bytes, token).ConfigureAwait(false);
                return Encode(bytes);
            }, token).WaitAsync(token).GetAwaiter().GetResult();
        }
        catch { return null; }
    }

    internal static string? Encode(byte[] bytes)
    {
        if (bytes.Length is 0 or > MaxSourceBytes) return null;
        try
        {
            using var input = new MemoryStream(bytes);
            var frame = BitmapFrame.Create(input, BitmapCreateOptions.DelayCreation, BitmapCacheOption.None);
            if (frame.PixelWidth is < 1 or > 8192 || frame.PixelHeight is < 1 or > 8192) return null;
            input.Position = 0;
            var image = new BitmapImage();
            image.BeginInit();
            image.CacheOption = BitmapCacheOption.OnLoad;
            if (frame.PixelWidth >= frame.PixelHeight) image.DecodePixelWidth = Math.Min(160, frame.PixelWidth);
            else image.DecodePixelHeight = Math.Min(160, frame.PixelHeight);
            image.StreamSource = input;
            image.EndInit();
            var encoder = new JpegBitmapEncoder { QualityLevel = 82 };
            encoder.Frames.Add(BitmapFrame.Create(image));
            using var output = new MemoryStream();
            encoder.Save(output);
            return output.Length <= MaxArtworkBytes ? "data:image/jpeg;base64," + Convert.ToBase64String(output.ToArray()) : null;
        }
        catch { return null; }
    }
}
