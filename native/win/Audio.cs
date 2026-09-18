// Master volume via the Core Audio API (IMMDeviceEnumerator / IAudioEndpointVolume).
//
// keybd_event volume keys move in fixed steps, so an absolute "set to 40%"
// request needs the endpoint interface instead.

using System.Runtime.InteropServices;

namespace WinDock;

internal static class Audio
{
    /// <param name="level">0.0 to 1.0</param>
    public static bool SetMasterVolume(float level)
    {
        if (level < 0f) level = 0f;
        if (level > 1f) level = 1f;
        return WithEndpoint(endpoint => endpoint.SetMasterVolumeLevelScalar(level, IntPtr.Zero) == 0);
    }

    public static float? GetMasterVolume()
    {
        float level = 0;
        return WithEndpoint(endpoint => endpoint.GetMasterVolumeLevelScalar(out level) == 0) ? level : null;
    }

    private static bool WithEndpoint(Func<IAudioEndpointVolume, bool> action)
    {
        IMMDeviceEnumerator? enumerator = null;
        IMMDevice? device = null;
        IAudioEndpointVolume? endpoint = null;
        try
        {
            enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
            // eRender = 0 (output), eMultimedia = 1 (default multimedia role).
            if (enumerator.GetDefaultAudioEndpoint(0, 1, out device) != 0 || device is null) return false;

            var iid = typeof(IAudioEndpointVolume).GUID;
            // CLSCTX_ALL = 23
            if (device.Activate(ref iid, 23, IntPtr.Zero, out var raw) != 0 || raw is null) return false;

            endpoint = (IAudioEndpointVolume)raw;
            return action(endpoint);
        }
        catch (COMException)
        {
            return false;
        }
        finally
        {
            if (endpoint is not null) Marshal.ReleaseComObject(endpoint);
            if (device is not null) Marshal.ReleaseComObject(device);
            if (enumerator is not null) Marshal.ReleaseComObject(enumerator);
        }
    }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    private class MMDeviceEnumerator { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator
    {
        [PreserveSig] int NotImpl1();
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice? endpoint);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams,
                     [MarshalAs(UnmanagedType.IUnknown)] out object? iface);
    }

    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioEndpointVolume
    {
        [PreserveSig] int NotImpl1();
        [PreserveSig] int NotImpl2();
        [PreserveSig] int GetChannelCount(out int count);
        [PreserveSig] int SetMasterVolumeLevel(float levelDb, IntPtr eventContext);
        [PreserveSig] int SetMasterVolumeLevelScalar(float level, IntPtr eventContext);
        [PreserveSig] int GetMasterVolumeLevel(out float levelDb);
        [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
    }
}
