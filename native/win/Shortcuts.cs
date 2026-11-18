using System.ComponentModel;
using System.Text.Json;

namespace WinDock;

/// <summary>
/// Key chords (modifiers + one key), held modifiers and the middle mouse button for the touchpad
/// session. Mirrors src/chords.js. Everything this class presses is released when the session ends,
/// so a dropped connection never leaves Shift or the middle button stuck down.
/// </summary>
internal sealed class Shortcuts(Func<Touchpad.Input[], uint> send, Func<int> lastError, Action<uint, int, int, int> inject)
{
    private const uint KeyUp = 2, Extended = 1;
    private static readonly Dictionary<string, ushort> ModifierKeys = new()
    {
        ["ctrl"] = 0xA2, ["shift"] = 0xA0, ["alt"] = 0xA4, ["win"] = 0x5B,
    };
    private static readonly Dictionary<string, (ushort Key, bool Extended)> Named = new()
    {
        ["Space"] = (0x20, false), ["Enter"] = (0x0D, false), ["Tab"] = (0x09, false), ["Escape"] = (0x1B, false),
        ["Backspace"] = (0x08, false), ["Delete"] = (0x2E, true), ["Insert"] = (0x2D, true),
        ["Home"] = (0x24, true), ["End"] = (0x23, true), ["PageUp"] = (0x21, true), ["PageDown"] = (0x22, true),
        ["ArrowLeft"] = (0x25, true), ["ArrowUp"] = (0x26, true), ["ArrowRight"] = (0x27, true), ["ArrowDown"] = (0x28, true),
        ["Comma"] = (0xBC, false), ["Period"] = (0xBE, false), ["Slash"] = (0xBF, false), ["Backslash"] = (0xDC, false),
        ["Minus"] = (0xBD, false), ["Equal"] = (0xBB, false), ["Semicolon"] = (0xBA, false), ["Quote"] = (0xDE, false),
        ["BracketLeft"] = (0xDB, false), ["BracketRight"] = (0xDD, false), ["Backquote"] = (0xC0, false),
        ["NumpadAdd"] = (0x6B, false), ["NumpadSubtract"] = (0x6D, false), ["NumpadMultiply"] = (0x6A, false),
        ["NumpadDivide"] = (0x6F, true), ["NumpadDecimal"] = (0x6E, false), ["NumpadEnter"] = (0x0D, true),
    };
    private readonly HashSet<string> held = [];
    private bool middle;

    private static Touchpad.Input Key(ushort key, bool up, bool extended) => new()
    {
        type = 1,
        value = new Touchpad.InputUnion { keyboard = new Touchpad.KeyboardInput { key = key, flags = (up ? KeyUp : 0u) | (extended ? Extended : 0u) } },
    };

    internal static (ushort Key, bool Extended) Resolve(string name)
    {
        if (name.Length == 1 && name[0] is >= 'a' and <= 'z') return ((ushort)(0x41 + name[0] - 'a'), false);
        if (name.Length == 1 && name[0] is >= '0' and <= '9') return ((ushort)(0x30 + name[0] - '0'), false);
        if ((name.Length == 2 || name.Length == 3) && name[0] == 'F' && int.TryParse(name.AsSpan(1), out var f) && f is >= 1 and <= 12)
            return ((ushort)(0x70 + f - 1), false);
        if (name.Length == 7 && name.StartsWith("Numpad", StringComparison.Ordinal) && name[6] is >= '0' and <= '9')
            return ((ushort)(0x60 + name[6] - '0'), false);
        if (Named.TryGetValue(name, out var found)) return found;
        throw new ArgumentException("Invalid key.");
    }

    private void Send(List<Touchpad.Input> inputs, string what)
    {
        if (inputs.Count == 0) return;
        if (send(inputs.ToArray()) != (uint)inputs.Count) throw new Win32Exception(lastError(), "Windows rejected " + what + ".");
    }

    /// <summary>Press and release one key with its modifiers in a single atomic batch.</summary>
    public void Chord(JsonElement message)
    {
        var mods = new List<string>();
        foreach (var item in message.GetProperty("mods").EnumerateArray())
        {
            var name = item.GetString() ?? "";
            if (!ModifierKeys.ContainsKey(name) || mods.Contains(name)) throw new ArgumentException("Invalid modifier.");
            mods.Add(name);
        }
        var key = Resolve(message.GetProperty("key").GetString() ?? "");
        var repeat = message.TryGetProperty("repeat", out var r) ? r.GetInt32() : 1;
        if (repeat < 1 || repeat > 20) throw new ArgumentException("Invalid repeat.");
        // Modifiers the person is already holding stay held and are not pressed again.
        var press = mods.Where(m => !held.Contains(m)).ToList();
        var inputs = new List<Touchpad.Input>();
        foreach (var m in press) inputs.Add(Key(ModifierKeys[m], false, false));
        for (var i = 0; i < repeat; i++) { inputs.Add(Key(key.Key, false, key.Extended)); inputs.Add(Key(key.Key, true, key.Extended)); }
        for (var i = press.Count - 1; i >= 0; i--) inputs.Add(Key(ModifierKeys[press[i]], true, false));
        Send(inputs, "the shortcut");
    }

    /// <summary>Hold or release one modifier until the person releases it or the session ends.</summary>
    public void Modifier(JsonElement message)
    {
        var name = message.GetProperty("key").GetString() ?? "";
        var down = message.GetProperty("down").GetBoolean();
        if (!ModifierKeys.TryGetValue(name, out var key)) throw new ArgumentException("Invalid modifier.");
        if (down && held.Add(name))
        {
            try { Send([Key(key, false, false)], "the modifier key"); }
            catch { held.Remove(name); throw; }
        }
        else if (!down && held.Remove(name)) Send([Key(key, true, false)], "the modifier release");
    }

    public void Middle(bool down)
    {
        if (middle == down) return;
        inject(down ? 0x0020u : 0x0040u, 0, 0, 0);
        middle = down;
    }

    public void Release()
    {
        Exception? failure = null;
        foreach (var name in held.ToList())
        {
            try { Send([Key(ModifierKeys[name], true, false)], "the modifier release"); } catch (Exception e) { failure ??= e; }
        }
        held.Clear();
        try { if (middle) inject(0x0040u, 0, 0, 0); } catch (Exception e) { failure ??= e; }
        middle = false;
        if (failure is not null) throw failure;
    }
}
