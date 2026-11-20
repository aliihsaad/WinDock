using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Text.Json;

namespace Tara;

internal static class Signature
{
    internal const int Width = 1600, Height = 600;
    internal static Bitmap Render(JsonElement value)
    {
        var color = value.GetProperty("color").GetString();
        if (color is not ("black" or "blue")) throw new ArgumentException("Invalid ink.");
        var strokes = value.GetProperty("strokes");
        if (strokes.GetArrayLength() is < 1 or > 64) throw new ArgumentException("Invalid strokes.");
        // Validate everything before allocating an image or creating any file.
        var lines = new List<PointF[]>();
        var count = 0;
        foreach (var stroke in strokes.EnumerateArray())
        {
            if (stroke.GetArrayLength() < 1 || (count += stroke.GetArrayLength()) > 2048) throw new ArgumentException("Too many points.");
            lines.Add(stroke.EnumerateArray().Select(point =>
            {
                if (point.GetArrayLength() != 2) throw new ArgumentException("Invalid point.");
                var x = point[0].GetSingle(); var y = point[1].GetSingle();
                if (!float.IsFinite(x) || !float.IsFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) throw new ArgumentException("Invalid point.");
                return new PointF(x * (Width - 1), y * (Height - 1));
            }).ToArray());
        }
        var image = new Bitmap(Width, Height, PixelFormat.Format32bppArgb);
        try
        {
            using var graphics = Graphics.FromImage(image);
            graphics.Clear(Color.Transparent);
            graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using var pen = new Pen(color == "blue" ? Color.FromArgb(30, 64, 175) : Color.FromArgb(24, 24, 27), 4) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round };
            using var brush = new SolidBrush(pen.Color);
            foreach (var line in lines)
            {
                if (line.Length == 1) graphics.FillEllipse(brush, line[0].X - 2, line[0].Y - 2, 4, 4);
                else graphics.DrawLines(pen, line);
            }
            return image;
        }
        catch { image.Dispose(); throw; }
    }

    public static int Save(bool insert = false)
    {
        var target = insert ? KeyboardFocus.GetForegroundWindow() : IntPtr.Zero;
        // Read a bounded payload from the private parent pipe, never an arbitrary client path.
        var chars = new char[65537];
        var length = 0;
        while (length < chars.Length)
        {
            var read = Console.In.Read(chars, length, chars.Length - length);
            if (read == 0) break;
            length += read;
        }
        if (length > 65536) throw new ArgumentException("Signature too large.");
        using var document = JsonDocument.Parse(new string(chars, 0, length));
        using var image = Render(document.RootElement);
        var folder = Environment.GetFolderPath(Environment.SpecialFolder.MyPictures);
        if (string.IsNullOrEmpty(folder)) folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Pictures");
        folder = Path.Combine(folder, "Tara", "Signatures");
        Directory.CreateDirectory(folder);
        var path = Path.Combine(folder, $"Signature-{DateTime.Now:yyyy-MM-dd-HHmmss}-{Guid.NewGuid():N}.png");
        using (var file = new FileStream(path, FileMode.CreateNew)) image.Save(file, ImageFormat.Png);
        var pasteRequested = false;
        if (insert)
        {
            using var png = new MemoryStream();
            image.Save(png, ImageFormat.Png);
            png.Position = 0;
            var data = new System.Windows.Forms.DataObject();
            data.SetData("PNG", false, png);
            data.SetData(System.Windows.Forms.DataFormats.Bitmap, true, image);
            System.Windows.Forms.Clipboard.SetDataObject(data, true, 4, 75);
            // Preserve the PNG on disk/clipboard even if focus changed or Windows blocks paste.
            if (target != IntPtr.Zero && target == KeyboardFocus.GetForegroundWindow() && !KeyboardFocus.ModifierDown())
            {
                var sent = Touchpad.Send([RemoteKeyboard.Key(0xA2), RemoteKeyboard.Key(0x56), RemoteKeyboard.Key(0x56, true), RemoteKeyboard.Key(0xA2, true)]);
                pasteRequested = sent == 4;
                if (sent is 2) Touchpad.Send([RemoteKeyboard.Key(0x56, true)]);
                if (sent is > 0 and < 4) Touchpad.Send([RemoteKeyboard.Key(0xA2, true)]);
            }
        }
        Console.Out.WriteLine(JsonSerializer.Serialize(new { type = "saved", path, name = Path.GetFileName(path), width = Width, height = Height, clipboard = insert, pasteRequested }));
        return 0;
    }
}
