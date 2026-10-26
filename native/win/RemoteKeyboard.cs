using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Automation;

namespace WinDock;

/** Unicode packets preserve emoji/surrogate pairs without a PC keyboard-layout mapping. */
internal sealed class RemoteKeyboard(Func<Touchpad.Input[], uint> send, Func<int> lastError)
{
    internal static Touchpad.Input Key(ushort key, bool up = false) => new() { type = 1, value = new Touchpad.InputUnion { keyboard = new Touchpad.KeyboardInput { key = key, flags = up ? 2u : 0u } } };
    private void Send(Touchpad.Input[] inputs)
    {
        var sent = send(inputs);
        if (sent == inputs.Length) return;
        var error = lastError();
        // Clean up a down packet if Windows accepted only part of the batch.
        if ((sent & 1) != 0) send([inputs[sent]]);
        throw new Win32Exception(error, "Windows rejected keyboard input.");
    }
    internal void Text(string text)
    {
        if (text.Length is < 1 or > 1024) throw new ArgumentException("Invalid text.");
        // Reject malformed UTF-16 and control characters, just like the Node boundary.
        _ = new UnicodeEncoding(false, false, true).GetBytes(text);
        if (text.Any(c => char.IsControl(c) && c is not ('\r' or '\n' or '\t'))) throw new ArgumentException("Invalid text.");
        var inputs = new List<Touchpad.Input>();
        foreach (var c in text)
        {
            inputs.Add(new() { type = 1, value = new Touchpad.InputUnion { keyboard = new Touchpad.KeyboardInput { scan = c, flags = 4 } } });
            inputs.Add(new() { type = 1, value = new Touchpad.InputUnion { keyboard = new Touchpad.KeyboardInput { scan = c, flags = 6 } } });
        }
        Send(inputs.ToArray());
    }
    internal void Press(string name)
    {
        ushort key = name switch {
            "Backspace" => 8, "Delete" => 46, "Enter" => 13, "Tab" => 9, "Escape" => 27,
            "ArrowLeft" => 37, "ArrowUp" => 38, "ArrowRight" => 39, "ArrowDown" => 40,
            "Home" => 36, "End" => 35, _ => throw new ArgumentException("Invalid key.")
        };
        Send([Key(key), Key(key, true)]);
    }

    internal static void ValidatePaste(string text)
    {
        if (text.Length is < 1 or > 32768 || text.Any(c => (c < 32 || c == 127) && c is not ('\r' or '\n' or '\t')))
            throw new ArgumentException("Invalid clipboard text.");
        _ = new UnicodeEncoding(false, false, true).GetBytes(text);
    }

    internal void Paste(string text, Func<bool> accepts, Action<string>? copyText = null)
    {
        ValidatePaste(text);
        if (!accepts()) throw new InvalidOperationException("Focus changed.");
        if (copyText != null) copyText(text);
        else CopyClipboard(text, accepts);
        if (!accepts()) throw new InvalidOperationException("Focus changed.");
        try { Send([Key(0x11), Key(0x56), Key(0x56, true), Key(0x11, true)]); }
        finally { send([Key(0x56, true), Key(0x11, true)]); }
    }

    private static void CopyClipboard(string text, Func<bool> accepts)
    {
        Exception? failure = null;
        // The input loop resumes on a pool thread. Clipboard writes require STA.
        var thread = new Thread(() => {
            try {
                if (!accepts()) throw new InvalidOperationException("Focus changed.");
                var data = new System.Windows.Forms.DataObject();
                data.SetData(System.Windows.Forms.DataFormats.UnicodeText, text);
                System.Windows.Forms.Clipboard.SetDataObject(data, true, 3, 50);
            } catch (Exception error) { failure = error; }
        }) { IsBackground = true, Name = "WinDock clipboard paste" };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        if (!thread.Join(2000) || failure != null) throw new InvalidOperationException("Clipboard unavailable.");
    }
}

/** Metadata only: never reads a field value, selection text, or password. */
internal sealed class KeyboardFocus(Action<object> emit) : IDisposable
{
    [DllImport("user32.dll")] internal static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    private readonly object gate = new();
    private readonly ManualResetEvent stopped = new(false);
    private Thread? thread;
    private IntPtr window;
    private string identity = "", target = "";
    private long revision;
    private bool editable, password;
    private int requested;
    internal static bool ModifierDown() => new[] { 0x10, 0x11, 0x12, 0x5B, 0x5C }.Any(key => (GetAsyncKeyState(key) & 0x8000) != 0);
    internal void Start()
    {
        thread = new Thread(Watch) { IsBackground = true, Name = "WinDock text focus" };
        thread.SetApartmentState(ApartmentState.MTA);
        thread.Start();
    }
    internal void Refresh() => Interlocked.Exchange(ref requested, 1);
    internal bool Accepts(string value)
    {
        lock (gate) return value == target && window != IntPtr.Zero && GetForegroundWindow() == window && !ModifierDown();
    }
    private void Watch()
    {
        do
        {
            var foreground = GetForegroundWindow();
            var id = foreground.ToString();
            var isEditable = false;
            var isPassword = false;
            try
            {
                var element = AutomationElement.FocusedElement;
                if (foreground != IntPtr.Zero && element != null)
                {
                    GetWindowThreadProcessId(foreground, out var process);
                    var current = element.Current;
                    if (current.ProcessId == process && current.IsEnabled && current.HasKeyboardFocus)
                    {
                        id += ":" + string.Join(".", element.GetRuntimeId());
                        isPassword = current.IsPassword;
                        if (element.TryGetCurrentPattern(ValuePattern.Pattern, out var value))
                            isEditable = !((ValuePattern)value).Current.IsReadOnly;
                        else if (current.ControlType == ControlType.Edit || isPassword)
                            isEditable = true;
                        else if (current.ControlType == ControlType.Document && element.TryGetCurrentPattern(TextPattern.Pattern, out var text))
                            isEditable = ((TextPattern)text).DocumentRange.GetAttributeValue(TextPattern.IsReadOnlyAttribute) is false;
                    }
                }
            }
            catch { /* Some apps do not expose UIA. The manual keyboard still works. */ }
            // Don't announce stale focus if it moved while an accessibility provider responded.
            if (GetForegroundWindow() != foreground) continue;
            lock (gate)
            {
                var changed = identity != id || editable != isEditable || password != isPassword;
                if (changed || target.Length == 0)
                {
                    window = foreground; identity = id; editable = isEditable; password = isPassword;
                    target = (++revision).ToString(System.Globalization.CultureInfo.InvariantCulture);
                }
                if (changed || Interlocked.Exchange(ref requested, 0) == 1)
                    emit(new { type = "focus", target, editable, password });
            }
        } while (!stopped.WaitOne(250));
    }
    public void Dispose()
    {
        stopped.Set();
        // Never hold shutdown hostage to an unresponsive app's accessibility provider.
        if (thread?.Join(300) == true) stopped.Dispose();
    }
}
