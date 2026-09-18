using System.Diagnostics;
using System.ComponentModel;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Text.Json;
using Windows.Media.Core;
using Windows.Media.MediaProperties;
using Windows.Media.Transcoding;
using Windows.Storage;

namespace WinDock;

// PNG screenshots and silent H.264 MP4 recordings; no extra encoder install.
// The recording worker owns its file. EOF on stdin (host exit) ends the stream
// cleanly so the MP4 index is written even when the phone disconnects.
internal static class ScreenCapture
{
    private const int Fps = 15;
    private static int stopping;
    [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr window);
    [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr window, IntPtr dc);
    [DllImport("gdi32.dll", SetLastError = true)] private static extern bool StretchBlt(IntPtr target, int x, int y, int width, int height, IntPtr source, int sx, int sy, int sw, int sh, uint operation);
    [DllImport("gdi32.dll")] private static extern int SetStretchBltMode(IntPtr dc, int mode);

    private static void Emit(object value) { Console.WriteLine(JsonSerializer.Serialize(value)); Console.Out.Flush(); }
    private static Rectangle MainScreen()
    {
        SetProcessDpiAwarenessContext(new IntPtr(-4));
        return Screen.PrimaryScreen?.Bounds ?? throw new InvalidOperationException("No main monitor is available.");
    }
    private static string Destination(bool video)
    {
        var root = Environment.GetFolderPath(video ? Environment.SpecialFolder.MyVideos : Environment.SpecialFolder.MyPictures);
        if (string.IsNullOrEmpty(root)) throw new IOException("Your capture folder is unavailable.");
        var folder = Path.Combine(root, "WinDock");
        Directory.CreateDirectory(folder);
        return Path.Combine(folder, $"WinDock-{DateTime.Now:yyyy-MM-dd-HHmmss-fff}-{Guid.NewGuid().ToString("N")[..6]}.{(video ? "mp4" : "png")}");
    }
    private static void CopyScreen(Graphics graphics, Rectangle bounds) =>
        graphics.CopyFromScreen(bounds.Location, Point.Empty, bounds.Size, CopyPixelOperation.SourceCopy);
    private static void CopyFrame(Graphics graphics, Rectangle bounds, int width, int height)
    {
        var screen = GetDC(IntPtr.Zero);
        if (screen == IntPtr.Zero) throw new Win32Exception();
        try
        {
            var target = graphics.GetHdc();
            try
            {
                SetStretchBltMode(target, 4); // HALFTONE: scale in GDI without a full-size intermediate bitmap.
                if (!StretchBlt(target, 0, 0, width, height, screen, bounds.X, bounds.Y, bounds.Width, bounds.Height, 0x00CC0020)) throw new Win32Exception();
            }
            finally { graphics.ReleaseHdc(target); }
        }
        finally { ReleaseDC(IntPtr.Zero, screen); }
    }

    public static int Run(string[] args)
    {
        if (args.Length != 2 || args[1] is not ("screenshot" or "record")) return 1;
        return args[1] == "screenshot" ? Screenshot() : Record().GetAwaiter().GetResult();
    }
    private static int Screenshot()
    {
        var bounds = MainScreen();
        using var bitmap = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format32bppRgb);
        using (var graphics = Graphics.FromImage(bitmap)) CopyScreen(graphics, bounds);
        var path = Destination(false);
        using (var file = new FileStream(path, FileMode.CreateNew)) bitmap.Save(file, ImageFormat.Png);
        Emit(new { type = "saved", kind = "screenshot", path, name = Path.GetFileName(path), width = bounds.Width, height = bounds.Height });
        return 0;
    }
    private static async Task<int> Record()
    {
        using var single = new Mutex(true, @"Local\WinDock.ScreenRecording", out var first);
        if (!first) throw new InvalidOperationException("A WinDock recording is already running.");
        var bounds = MainScreen();
        // Preserve aspect ratio and fit inside 1920x1080; H.264 needs even sizes.
        var scale = Math.Min(1, Math.Min(1920d / bounds.Width, 1080d / bounds.Height));
        var width = Math.Max(2, (int)(bounds.Width * scale) / 2 * 2);
        var height = Math.Max(2, (int)(bounds.Height * scale) / 2 * 2);
        var path = Destination(true);
        using var frame = new Bitmap(width, height, PixelFormat.Format32bppArgb);
        using var frameGraphics = Graphics.FromImage(frame);
        var raw = VideoEncodingProperties.CreateUncompressed(MediaEncodingSubtypes.Bgra8, (uint)width, (uint)height);
        raw.FrameRate.Numerator = Fps; raw.FrameRate.Denominator = 1;
        var source = new MediaStreamSource(new VideoStreamDescriptor(raw)) { BufferTime = TimeSpan.Zero, CanSeek = false };
        var clock = new Stopwatch();
        Exception? captureError = null;
        var nextFrame = TimeSpan.Zero;
        var frameTime = TimeSpan.FromSeconds(1d / Fps);
        source.Starting += (_, e) => e.Request.SetActualStartPosition(TimeSpan.Zero);
        source.SampleRequested += (_, e) =>
        {
            try
            {
                if (Volatile.Read(ref stopping) != 0 || clock.Elapsed.TotalMinutes >= 60) return;
                if (!clock.IsRunning) clock.Start();
                var delay = nextFrame - clock.Elapsed;
                if (delay > TimeSpan.Zero) Thread.Sleep(delay);
                if (Volatile.Read(ref stopping) != 0) return;
                var timestamp = clock.Elapsed;
                nextFrame = timestamp + frameTime;
                CopyFrame(frameGraphics, bounds, width, height);
                var data = frame.LockBits(new Rectangle(0, 0, width, height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
                var bytes = new byte[width * height * 4];
                try { Marshal.Copy(data.Scan0, bytes, 0, bytes.Length); }
                finally { frame.UnlockBits(data); }
                var sample = MediaStreamSample.CreateFromBuffer(bytes.AsBuffer(), timestamp);
                sample.Duration = frameTime;
                e.Request.Sample = sample;
            }
            catch (Exception ex) { captureError = ex; Interlocked.Exchange(ref stopping, 1); }
        };
        var profile = MediaEncodingProfile.CreateMp4(VideoEncodingQuality.HD1080p);
        profile.Audio = null;
        profile.Video.Width = (uint)width; profile.Video.Height = (uint)height;
        profile.Video.FrameRate.Numerator = Fps; profile.Video.FrameRate.Denominator = 1;
        profile.Video.Bitrate = 6_000_000;
        try
        {
            // Reserve a unique filename; incomplete files are removed on failure.
            using (File.Create(path)) { }
            var file = await StorageFile.GetFileFromPathAsync(path);
            using (var output = await file.OpenAsync(FileAccessMode.ReadWrite))
            {
                var encoder = new MediaTranscoder { HardwareAccelerationEnabled = true };
                var prepared = await encoder.PrepareMediaStreamSourceTranscodeAsync(source, output, profile);
                if (!prepared.CanTranscode) throw new InvalidOperationException($"Windows video encoder unavailable: {prepared.FailureReason}");
                var encoding = prepared.TranscodeAsync().AsTask();
                Emit(new { type = "recording", startedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), width, height, fps = Fps });
                _ = Task.Run(() => { Console.ReadLine(); Interlocked.Exchange(ref stopping, 1); });
                await encoding;
                if (captureError is not null) throw captureError;
                await output.FlushAsync();
            }
            Emit(new { type = "saved", kind = "recording", path, name = Path.GetFileName(path), width, height, durationMs = clock.ElapsedMilliseconds });
            return 0;
        }
        catch { try { File.Delete(path); } catch (IOException) { } throw; }
    }
}
