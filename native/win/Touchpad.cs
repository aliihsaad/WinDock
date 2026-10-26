using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace WinDock;

internal static class Touchpad
{
    [StructLayout(LayoutKind.Sequential)]
    internal struct MouseInput { public int dx, dy; public uint data, flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)]
    internal struct KeyboardInput { public ushort key, scan; public uint flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Explicit)]
    internal struct InputUnion
    {
        [FieldOffset(0)] public MouseInput mouse;
        [FieldOffset(0)] public KeyboardInput keyboard;
    }
    [StructLayout(LayoutKind.Sequential)]
    internal struct Input { public uint type; public InputUnion value; }
    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, Input[] inputs, int size);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    internal static uint Send(Input[] inputs) => SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<Input>());

    // The union's largest member is MOUSEINPUT on x64. Never use the keyboard-only size.
    private static void Inject(uint flags, int dx = 0, int dy = 0, int data = 0)
    {
        var value = new Input { type = 0, value = new InputUnion { mouse = new MouseInput { dx = dx, dy = dy, data = unchecked((uint)data), flags = flags } } };
        if (Send([value]) != 1) throw new Win32Exception(Marshal.GetLastWin32Error(), "Windows rejected mouse input.");
    }

    internal sealed class ZoomInput(Func<Input[], uint> send, Func<bool> controlDown, Func<int> lastError)
    {
        private bool ownsControl;
        private static Input Control(bool up) => new() { type = 1, value = new InputUnion { keyboard = new KeyboardInput { key = 0xA2, flags = up ? 2u : 0u } } };
        public void Release()
        {
            if (!ownsControl) return;
            if (send([Control(true)]) != 1) throw new Win32Exception(lastError(), "Windows rejected zoom key release.");
            ownsControl = false;
        }
        public void Apply(int steps)
        {
            if (steps == 0 || steps < -8 || steps > 8) throw new ArgumentException("Invalid zoom.");
            var wheel = new Input { type = 0, value = new InputUnion { mouse = new MouseInput { flags = 0x0800, data = unchecked((uint)(steps * 120)) } } };
            // One atomic batch keeps Ctrl scoped to this wheel event. Leave an
            // already-held Ctrl key alone, including a physical right Ctrl.
            var inputs = controlDown() ? new[] { wheel } : new[] { Control(false), wheel, Control(true) };
            var sent = send(inputs);
            ownsControl = inputs.Length == 3 && sent > 0 && sent < 3;
            var error = lastError();
            try { if (sent != inputs.Length) throw new Win32Exception(error, "Windows rejected zoom input."); }
            finally { Release(); }
        }
    }

    internal sealed class Session(Action<uint, int, int, int> inject, Action<int> zoom, Action releaseZoom)
    {
        private bool left, right;
        public void Release()
        {
            // Only release buttons held by this session, never unrelated physical input.
            try { if (left) inject(0x0004, 0, 0, 0); }
            finally { left = false; try { if (right) inject(0x0010, 0, 0, 0); } finally { right = false; releaseZoom(); } }
        }
        public void Apply(JsonElement message)
        {
            var type = message.GetProperty("type").GetString();
            switch (type)
            {
                case "ping": return;
                case "release": Release(); return;
                case "zoom":
                    var steps = message.GetProperty("steps").GetInt32();
                    if (steps == 0 || steps < -8 || steps > 8) throw new ArgumentException("Invalid zoom.");
                    if (!left && !right) zoom(steps);
                    return;
                case "move": case "scroll":
                    var dx = message.GetProperty("dx").GetInt32();
                    var dy = message.GetProperty("dy").GetInt32();
                    if (dx < -2048 || dx > 2048 || dy < -2048 || dy > 2048) throw new ArgumentException("Invalid movement.");
                    if (type == "move") inject(0x0001, dx, dy, 0);
                    else
                    {
                        if (dy != 0) inject(0x0800, 0, 0, dy);
                        if (dx != 0) inject(0x1000, 0, 0, dx);
                    }
                    return;
                case "button":
                    var button = message.GetProperty("button").GetString();
                    var down = message.GetProperty("down").GetBoolean();
                    if (button is not ("left" or "right")) throw new ArgumentException("Invalid button.");
                    if (button == "left") { if (left != down) { inject(down ? 0x0002u : 0x0004u, 0, 0, 0); left = down; } }
                    else { if (right != down) { inject(down ? 0x0008u : 0x0010u, 0, 0, 0); right = down; } }
                    return;
                default: throw new ArgumentException("Invalid input type.");
            }
        }
    }

    public static int Run() => RunAsync().GetAwaiter().GetResult();
    private static async Task<int> RunAsync()
    {
        using var single = new Mutex(true, @"Local\WinDock.Touchpad", out var first);
        if (!first) throw new InvalidOperationException("Another touchpad is active.");
        var zoom = new ZoomInput(Send, () => (GetAsyncKeyState(0x11) & 0x8000) != 0, Marshal.GetLastWin32Error);
        var session = new Session(Inject, zoom.Apply, zoom.Release);
        var outputGate = new object();
        void Emit(object value) { lock (outputGate) { Console.Out.WriteLine(JsonSerializer.Serialize(value)); Console.Out.Flush(); } }
        var keyboard = new RemoteKeyboard(Send, Marshal.GetLastWin32Error);
        using var focus = new KeyboardFocus(Emit);
        using var input = new StreamReader(Console.OpenStandardInput(), new System.Text.UTF8Encoding(false, true));
        Emit(new { type = "ready" });
        focus.Start();
        try
        {
            while (true)
            {
                // Also releases buttons if Node crashes or stops forwarding the phone heartbeat.
                var line = await input.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(2));
                if (line is null) break;
                if (line.Length > 262144) throw new ArgumentException("Input too large.");
                using var message = JsonDocument.Parse(line);
                var root = message.RootElement;
                var type = root.GetProperty("type").GetString();
                if (type == "focus") { focus.Refresh(); continue; }
                if (type is "text" or "key" or "paste")
                {
                    try
                    {
                        if (!focus.Accepts(root.GetProperty("target").GetString() ?? "")) throw new InvalidOperationException("Focus changed.");
                        session.Release();
                        if (type == "text") keyboard.Text(root.GetProperty("text").GetString() ?? "");
                        else if (type == "paste")
                        {
                            var target = root.GetProperty("target").GetString() ?? "";
                            keyboard.Paste(root.GetProperty("text").GetString() ?? "", () => focus.Accepts(target));
                            Emit(new { type = "paste-result" });
                        }
                        else keyboard.Press(root.GetProperty("key").GetString() ?? "");
                    }
                    catch { Emit(new { type = "input-error" }); focus.Refresh(); }
                }
                else session.Apply(root);
            }
        }
        catch (TimeoutException) { return 0; }
        finally { session.Release(); }
        return 0;
    }
}
