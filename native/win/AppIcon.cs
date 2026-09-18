using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace WinDock;

internal static class AppIcon
{
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int SHDefExtractIconW(string file, int index, uint flags,
        out IntPtr large, IntPtr small, uint size);
    [DllImport("user32.dll")]
    private static extern bool DestroyIcon(IntPtr icon);

    // Sources come from the host's installed-app inventory, never a URL path.
    // Honor shortcut resource indexes (including negative resource IDs), then
    // fall back to the executable. Do not access network shares for icons.
    public static string? Extract(string target, string location)
    {
        var resource = Environment.ExpandEnvironmentVariables(location.Trim());
        var index = 0;
        var comma = resource.LastIndexOf(',');
        if (comma >= 0 && int.TryParse(resource[(comma + 1)..], out var parsed))
        {
            index = parsed;
            resource = resource[..comma];
        }
        return Read(resource.Trim().Trim('"'), index)
            ?? Read(Environment.ExpandEnvironmentVariables(target), 0);
    }

    private static string? Read(string file, int index)
    {
        if (!Path.IsPathFullyQualified(file) || file.StartsWith(@"\\") || !File.Exists(file)) return null;
        IntPtr handle = IntPtr.Zero;
        try
        {
            if (SHDefExtractIconW(file, index, 0, out handle, IntPtr.Zero, 256) != 0 || handle == IntPtr.Zero) return null;
            using var icon = Icon.FromHandle(handle);
            using var bitmap = icon.ToBitmap();
            using var stream = new MemoryStream();
            bitmap.Save(stream, ImageFormat.Png);
            return Convert.ToBase64String(stream.ToArray());
        }
        catch { return null; }
        finally { if (handle != IntPtr.Zero) DestroyIcon(handle); }
    }
}
