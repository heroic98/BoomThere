# BoomThere radial menu repro: Alt+RB open -> move to top -> LB pick -> Alt+RB reopen x2
# Restores cursor at the end. All clicks are swallowed by the BoomThere hook.
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class BTInput {
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);

  [StructLayout(LayoutKind.Sequential)]
  struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint flags; public uint time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)]
  struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint flags; public uint time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)]
  struct INPUTUNION {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct INPUT { public uint type; public INPUTUNION u; }
  const uint INPUT_MOUSE = 0; const uint INPUT_KEYBOARD = 1;
  const uint RIGHTDOWN = 0x0008; const uint RIGHTUP = 0x0010;
  const uint LEFTDOWN = 0x0002; const uint LEFTUP = 0x0004;
  const uint KEYUP = 0x0002;
  const ushort VK_MENU = 0x12; const ushort VK_ESCAPE = 0x1B;

  static void Send(INPUT[] arr) { SendInput((uint)arr.Length, arr, Marshal.SizeOf(typeof(INPUT))); }
  [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] i, int size);

  public static void Alt(bool up) {
    var i = new INPUT[1];
    i[0].type = INPUT_KEYBOARD;
    i[0].u.ki = new KEYBDINPUT();
    i[0].u.ki.wVk = VK_MENU;
    i[0].u.ki.flags = up ? KEYUP : 0;
    Send(i);
  }
  public static void RButton(bool up) {
    var i = new INPUT[1];
    i[0].type = INPUT_MOUSE;
    i[0].u.mi = new MOUSEINPUT();
    i[0].u.mi.flags = up ? RIGHTUP : RIGHTDOWN;
    Send(i);
  }
  public static void LButton(bool up) {
    var i = new INPUT[1];
    i[0].type = INPUT_MOUSE;
    i[0].u.mi = new MOUSEINPUT();
    i[0].u.mi.flags = up ? LEFTUP : LEFTDOWN;
    Send(i);
  }
  public static void Esc() {
    var d = new INPUT[1]; d[0].type = INPUT_KEYBOARD; d[0].u.ki = new KEYBDINPUT(); d[0].u.ki.wVk = VK_ESCAPE; Send(d);
    var u = new INPUT[1]; u[0].type = INPUT_KEYBOARD; u[0].u.ki = new KEYBDINPUT(); u[0].u.ki.wVk = VK_ESCAPE; u[0].u.ki.flags = KEYUP; Send(u);
  }
}
"@

$orig = New-Object BTInput+POINT
[BTInput]::GetCursorPos([ref]$orig) | Out-Null

try {
  $cx = 700; $cy = 480
  [BTInput]::SetCursorPos($cx, $cy) | Out-Null
  Start-Sleep -Milliseconds 200

  Write-Host "[1] Alt+RB: open wheel"
  [BTInput]::Alt($false); Start-Sleep -Milliseconds 80
  [BTInput]::RButton($false); Start-Sleep -Milliseconds 60
  [BTInput]::RButton($true); Start-Sleep -Milliseconds 120
  [BTInput]::Alt($true)
  Start-Sleep -Milliseconds 700

  Write-Host "[2] move to top sector + LB pick"
  [BTInput]::SetCursorPos($cx, ($cy - 190)) | Out-Null
  Start-Sleep -Milliseconds 500
  [BTInput]::LButton($false); Start-Sleep -Milliseconds 50
  [BTInput]::LButton($true)
  Start-Sleep -Milliseconds 900

  Write-Host "[3] Alt+RB: REOPEN attempt"
  [BTInput]::SetCursorPos($cx, $cy) | Out-Null
  Start-Sleep -Milliseconds 200
  [BTInput]::Alt($false); Start-Sleep -Milliseconds 80
  [BTInput]::RButton($false); Start-Sleep -Milliseconds 60
  [BTInput]::RButton($true); Start-Sleep -Milliseconds 120
  [BTInput]::Alt($true)
  Start-Sleep -Milliseconds 800

  Write-Host "[4] second Alt+RB attempt"
  [BTInput]::Alt($false); Start-Sleep -Milliseconds 80
  [BTInput]::RButton($false); Start-Sleep -Milliseconds 60
  [BTInput]::RButton($true); Start-Sleep -Milliseconds 120
  [BTInput]::Alt($true)
  Start-Sleep -Milliseconds 600

  Write-Host "[5] cleanup: right-click cancel if wheel still open"
  [BTInput]::RButton($false); Start-Sleep -Milliseconds 60
  [BTInput]::RButton($true)
  Start-Sleep -Milliseconds 300
} finally {
  [BTInput]::Esc()
  [BTInput]::SetCursorPos($orig.X, $orig.Y) | Out-Null
  Write-Host "cursor restored"
}
