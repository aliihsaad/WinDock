using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;

namespace WinDock;

internal static partial class PackagedApp
{
    [GeneratedRegex(@"\A[A-Za-z0-9][A-Za-z0-9.-]*_[A-Za-z0-9]+![A-Za-z0-9][A-Za-z0-9._-]*\z")]
    private static partial Regex Identifier();

    public static bool IsValid(string id) => id.Length <= 128 && Identifier().IsMatch(id);

    public static void Launch(string id)
    {
        if (!IsValid(id)) throw new ArgumentException("Invalid packaged app identifier.");
        // Shell activation supports packaged desktop and Store apps without
        // relying on a version-specific WindowsApps executable path. No shell
        // command line is built; this is one validated Shell namespace item.
        using var process = Process.Start(new ProcessStartInfo
        {
            FileName = @"shell:AppsFolder\" + id,
            UseShellExecute = true,
        });
        // Shell activation may return no process when an existing app handles it.
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Size { public int Width, Height; }

    [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItemImageFactory
    {
        [PreserveSig] int GetImage(Size size, uint flags, out IntPtr bitmap);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
    private static extern int SHCreateItemFromParsingName(string path, IntPtr bindContext,
        ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory factory);
    [DllImport("ole32.dll")] private static extern int CoInitializeEx(IntPtr reserved, uint mode);
    [DllImport("ole32.dll")] private static extern void CoUninitialize();
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr value);
    [DllImport("gdi32.dll", EntryPoint = "GetObjectW")]
    private static extern int GetObject(IntPtr value, int size, out DibSection bitmap);

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeBitmap
    {
        public int Type, Width, Height, WidthBytes;
        public ushort Planes, BitsPixel;
        public IntPtr Bits;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BitmapInfoHeader
    {
        public uint Size;
        public int Width, Height;
        public ushort Planes, BitCount;
        public uint Compression, SizeImage;
        public int XPelsPerMeter, YPelsPerMeter;
        public uint ClrUsed, ClrImportant;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DibSection
    {
        public NativeBitmap Bitmap;
        public BitmapInfoHeader Header;
        public uint RedMask, GreenMask, BlueMask;
        public IntPtr Section;
        public uint Offset;
    }

    public static string? Icon(string id)
    {
        if (!IsValid(id)) throw new ArgumentException("Invalid packaged app identifier.");
        var initialized = CoInitializeEx(IntPtr.Zero, 0);
        IntPtr handle = IntPtr.Zero;
        IShellItemImageFactory? factory = null;
        try
        {
            var iid = typeof(IShellItemImageFactory).GUID;
            Marshal.ThrowExceptionForHR(SHCreateItemFromParsingName(@"shell:AppsFolder\" + id,
                IntPtr.Zero, ref iid, out factory));
            // SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK | SIIGBF_SCALEUP.
            Marshal.ThrowExceptionForHR(factory.GetImage(new Size { Width = 256, Height = 256 }, 0x105, out handle));
            if (handle == IntPtr.Zero) return null;
            using var bitmap = CopyBitmap(handle);
            using var stream = new MemoryStream();
            bitmap.Save(stream, ImageFormat.Png);
            return Convert.ToBase64String(stream.ToArray());
        }
        catch { return null; }
        finally
        {
            if (handle != IntPtr.Zero) DeleteObject(handle);
            if (factory is not null) Marshal.ReleaseComObject(factory);
            if (initialized >= 0) CoUninitialize();
        }
    }

    private static Bitmap CopyBitmap(IntPtr handle)
    {
        // Preserve the alpha channel in the Shell's 32-bit DIB; FromHbitmap
        // alone discards it and leaves black backgrounds behind app artwork.
        if (GetObject(handle, Marshal.SizeOf<DibSection>(), out var data) != 0 &&
            data.Bitmap.BitsPixel == 32 && data.Bitmap.Bits != IntPtr.Zero)
        {
            var pixels = data.Bitmap;
            using var view = new Bitmap(pixels.Width, Math.Abs(pixels.Height), pixels.WidthBytes,
                PixelFormat.Format32bppPArgb, pixels.Bits);
            var copy = view.Clone(new Rectangle(0, 0, view.Width, view.Height), PixelFormat.Format32bppArgb);
            // Positive biHeight means the native DIB starts with its bottom row.
            if (data.Header.Height > 0) copy.RotateFlip(RotateFlipType.RotateNoneFlipY);
            return copy;
        }
        return Image.FromHbitmap(handle);
    }
}
