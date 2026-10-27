# Watches the top-level windows so Capri can sit on them.
# Prints one JSON line whenever something changes: the foreground window and the visible
# windows in z-order (front first), as physical-pixel frame bounds. No contents, and no titles:
# the title of the window in front is only checked against a short list of AI names (ChatGPT,
# Gemini...) for her jealousy, and all that goes out is which of them matched ("ai").
#
#   powershell -File windows.ps1 <capri hwnd> <capri pid>

param([long]$Self = 0, [int]$ParentPid = 0)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;

public static class CapriWindows {
  delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }

  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hwnd, int index);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr hwnd, StringBuilder name, int max);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out RECT value, int size);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out int value, int size);

  const int GWL_EXSTYLE = -20;
  const int WS_EX_TOOLWINDOW = 0x80;
  const int WS_EX_NOACTIVATE = 0x08000000;
  const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
  const int DWMWA_CLOAKED = 14;

  // Other AIs: a key, what gives them away in the title of the window in front, and the name of
  // their own app's program, if they have one.
  static readonly string[][] AIS = {
    new[] { "chatgpt", @"\bChatGPT\b", "chatgpt" },
    new[] { "claude", @"\bClaude\b", "claude" },
    new[] { "codex", @"\bCodex\b", "codex" },
    new[] { "gemini", @"\bGemini\b", "" },
    new[] { "copilot", @"\bCopilot\b", "copilot" },
    new[] { "perplexity", @"\bPerplexity\b", "perplexity" },
    new[] { "deepseek", @"\bDeepSeek\b", "" },
    new[] { "grok", @"\bGrok\b", "" },
    new[] { "lechat", @"\bLe Chat\b|\bMistral AI\b", "" },
    new[] { "characterai", @"character\.ai", "" },
    new[] { "metaai", @"\bMeta AI\b", "" },
  };
  static IntPtr procOf = IntPtr.Zero;
  static string proc = "";

  // Which of them the window in front is, as a JSON list of keys.
  static string Ai(IntPtr fg) {
    var title = new StringBuilder(512);
    GetWindowText(fg, title, 512);
    if (fg != procOf) {
      procOf = fg;
      proc = "";
      uint pid;
      GetWindowThreadProcessId(fg, out pid);
      try { proc = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName.ToLowerInvariant(); } catch {}
    }
    string t = title.ToString();
    var keys = new StringBuilder();
    foreach (var ai in AIS) {
      if (!Regex.IsMatch(t, ai[1], RegexOptions.IgnoreCase) && (ai[2] == "" || proc != ai[2])) continue;
      if (keys.Length > 0) keys.Append(',');
      keys.Append('"').Append(ai[0]).Append('"');
    }
    return "[" + keys.ToString() + "]";
  }

  public static void Init() {
    SetProcessDpiAwarenessContext(new IntPtr(-4)); // per-monitor v2: real pixels everywhere
  }

  public static string Snapshot(long self) {
    var sb = new StringBuilder();
    IntPtr fg = GetForegroundWindow();
    var fgClass = new StringBuilder(64);
    GetClassName(fg, fgClass, 64);
    // the taskbar clicked: it comes up over her (Windows has no levels among windows on top)
    bool taskbar = fgClass.ToString() == "Shell_TrayWnd" || fgClass.ToString() == "Shell_SecondaryTrayWnd";
    sb.Append("{\"fg\":").Append(fg.ToInt64()).Append(",\"taskbar\":").Append(taskbar ? "true" : "false")
      .Append(",\"ai\":").Append(Ai(fg)).Append(",\"wins\":[");
    int count = 0;
    EnumWindows((h, l) => {
      if (count >= 40) return false;
      if (h.ToInt64() == self || !IsWindowVisible(h) || IsIconic(h)) return true;
      int ex = GetWindowLong(h, GWL_EXSTYLE);
      if ((ex & WS_EX_TOOLWINDOW) != 0 || (ex & WS_EX_NOACTIVATE) != 0) return true;
      int cloaked;
      if (DwmGetWindowAttribute(h, DWMWA_CLOAKED, out cloaked, 4) == 0 && cloaked != 0) return true;
      var cls = new StringBuilder(64);
      GetClassName(h, cls, 64);
      string c = cls.ToString();
      if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd") return true;
      RECT r;
      if (DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, out r, 16) != 0) return true;
      if (r.Right - r.Left < 200 || r.Bottom - r.Top < 120) return true;
      if (count > 0) sb.Append(',');
      count++;
      sb.Append("{\"id\":").Append(h.ToInt64())
        .Append(",\"x\":").Append(r.Left).Append(",\"y\":").Append(r.Top)
        .Append(",\"w\":").Append(r.Right - r.Left).Append(",\"h\":").Append(r.Bottom - r.Top)
        .Append(",\"max\":").Append(IsZoomed(h) ? "true" : "false").Append('}');
      return true;
    }, IntPtr.Zero);
    sb.Append("]}");
    return sb.ToString();
  }
}
"@

[CapriWindows]::Init()
$last = ''
$tick = 0
while ($true) {
  $snap = [CapriWindows]::Snapshot($Self)
  if ($snap -ne $last) {
    [Console]::Out.WriteLine($snap)
    [Console]::Out.Flush()
    $last = $snap
  }
  # stop with Capri, even if she crashed without telling us
  $tick++
  if ($ParentPid -and ($tick % 20 -eq 0) -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Milliseconds 150
}
