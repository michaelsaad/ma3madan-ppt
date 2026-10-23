# Window helper: the things COM can't do for the slide show window.
# - find it, put it on the projector screen
# - click inside it (a real click: PowerPoint ignores posted mouse messages), then put the mouse back
#
# Protocol like host.js: one JSON command per line in, one JSON reply per line out.
$ErrorActionPreference = 'Stop'
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public class Win {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr c);
  [DllImport("shcore.dll")] public static extern int SetProcessDpiAwareness(int v);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromPoint(POINT p, uint f);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFOEX i);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint f);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int x, int y, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int pid);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr p);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  // Windows only lets the active program hand over the foreground: borrow its input queue for a moment.
  public static bool Activate(IntPtr h) {
    var fg = GetForegroundWindow();
    if (fg == h) return true;
    uint me = GetCurrentThreadId(), them = GetWindowThreadProcessId(fg, IntPtr.Zero);
    if (them != me) AttachThreadInput(me, them, true);
    BringWindowToTop(h); var ok = SetForegroundWindow(h);
    if (them != me) AttachThreadInput(me, them, false);
    return ok;
  }
  public static string ClassAt(int x, int y) { var p = new POINT { X = x, Y = y }; var h = GetAncestor(WindowFromPoint(p), 2); var c = new StringBuilder(64); GetClassName(h, c, 64); return c.ToString(); }
  public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct MONITORINFOEX { public int cbSize; public RECT rcMonitor; public RECT rcWork; public int dwFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szDevice; }

  // Real pixels on every screen, whatever each one's scaling (125 %, 150 %…). Electron hands us
  // per-monitor pixels; a "system aware" helper gets them scaled on a screen with another scaling,
  // which is what left the show on half the projector. Per thread, because powershell.exe has its
  // own manifest setting; older Windows 10 builds fall back step by step.
  static bool processSet;
  public static string Aware() {
    try { if (SetThreadDpiAwarenessContext(new IntPtr(-4)) != IntPtr.Zero) return "pmv2"; } catch (Exception) {}
    if (processSet) return "process";
    processSet = true;
    try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return "pmv2-process"; } catch (Exception) {}
    try { if (SetProcessDpiAwareness(2) == 0) return "pm"; } catch (Exception) {}
    SetProcessDPIAware(); return "system";
  }
  public static MONITORINFOEX Monitor(int x, int y) {
    var i = new MONITORINFOEX(); i.cbSize = Marshal.SizeOf(typeof(MONITORINFOEX));
    GetMonitorInfo(MonitorFromPoint(new POINT { X = x, Y = y }, 2), ref i);
    return i;
  }
  public struct POINT { public int X, Y; }

  // The slide show: full screen it's a "screenClass" window; in a window it's a PowerPoint frame
  // whose title starts with "PowerPoint Slide Show".
  public static IntPtr Show() {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var c = new StringBuilder(64); GetClassName(h, c, 64);
      var t = new StringBuilder(256); GetWindowText(h, t, 256);
      if (c.ToString() == "screenClass" || (c.ToString() == "PPTFrameClass" && t.ToString().StartsWith("PowerPoint Slide Show"))) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
$dpi = [Win]::Aware()

function Rect($h) { $r = New-Object Win+RECT; [Win]::GetWindowRect($h, [ref]$r) | Out-Null; @{ x = $r.L; y = $r.T; w = $r.R - $r.L; h = $r.B - $r.T } }

function Find() {
  for ($i = 0; $i -lt 30; $i++) { $h = [Win]::Show(); if ($h -ne [IntPtr]::Zero) { return $h }; Start-Sleep -Milliseconds 100 }
  throw 'no slide show window'
}

$commands = @{
  ping = { @{ dpi = $dpi } }
  find = { $h = Find; @{ hwnd = [int64]$h; rect = (Rect $h) } }
  # The screen at x, y (real pixels): its exact rectangle and its name for PowerPoint (DISPLAY2…).
  monitor = { param($a) $m = [Win]::Monitor($a.x, $a.y); $r = $m.rcMonitor; @{ device = $m.szDevice; rect = @{ x = $r.L; y = $r.T; w = $r.R - $r.L; h = $r.B - $r.T } } }
  # Fill the screen at x, y exactly. Exactly is what makes Windows treat it as full screen (no
  # taskbar over it); top: above everything there (when the show is on its own screen).
  place = {
    param($a)
    $h = Find; $m = [Win]::Monitor($a.x, $a.y); $r = $m.rcMonitor
    $want = @{ x = $r.L; y = $r.T; w = $r.R - $r.L; h = $r.B - $r.T }
    $cur = Rect $h
    $moved = $false
    if ($cur.x -ne $want.x -or $cur.y -ne $want.y -or $cur.w -ne $want.w -or $cur.h -ne $want.h -or $a.top) {
      $after = if ($a.top) { [IntPtr](-1) } else { [IntPtr]::Zero }
      $flags = if ($a.top) { 0x0070 } else { 0x0074 }  # NOACTIVATE|FRAMECHANGED|SHOWWINDOW (+NOZORDER)
      [Win]::SetWindowPos($h, $after, $want.x, $want.y, $want.w, $want.h, $flags) | Out-Null
      $moved = $true
    }
    @{ rect = (Rect $h); want = $want; moved = $moved; device = $m.szDevice }
  }
  # fx, fy: where on the slide (0..1 of the show window); back: our window, to give it the keyboard back
  click = {
    param($a)
    $h = Find; $r = Rect $h
    $p = New-Object Win+POINT; [Win]::GetCursorPos([ref]$p) | Out-Null
    $x = $r.x + [int]($r.w * $a.fx); $y = $r.y + [int]($r.h * $a.fy)
    $under = [Win]::ClassAt($x, $y)
    # PowerPoint only acts on a click when the show is the active window (else the click just
    # activates it), so make it active first, and give the keyboard back afterwards.
    $activated = [Win]::Activate($h)
    Start-Sleep -Milliseconds 60
    [Win]::SetCursorPos($x, $y) | Out-Null
    # A real move first: PowerPoint finds what's under the pointer when it moves, not on the click.
    [Win]::mouse_event(1, 1, 0, 0, [IntPtr]::Zero); [Win]::mouse_event(1, -1, 0, 0, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 80
    [Win]::mouse_event(2, 0, 0, 0, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 30
    [Win]::mouse_event(4, 0, 0, 0, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 60
    [Win]::SetCursorPos($p.X, $p.Y) | Out-Null
    if ($a.back) { [Win]::Activate([IntPtr][int64]$a.back) | Out-Null }
    @{ x = $x; y = $y; under = $under; activated = $activated }
  }
  focus = { param($a) [Win]::Activate([IntPtr][int64]$a.hwnd) }
}

[Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if (-not $line) { continue }
  $id = 0
  try {
    $msg = $line | ConvertFrom-Json
    [Win]::Aware() | Out-Null
    $id = $msg.id
    $result = & $commands[$msg.cmd] $msg.args
    $out = @{ id = $id; ok = $true; result = $result }
  } catch {
    $out = @{ id = $id; ok = $false; error = "$_" }
  }
  [Console]::Out.WriteLine(($out | ConvertTo-Json -Compress -Depth 5))
  [Console]::Out.Flush()
}
