using System;
using System.Diagnostics;
using System.IO;
using System.Text.RegularExpressions;
// First-party GUI trampoline: detached console hosts cannot run Windows
// PowerShell reliably, and non-detached libuv children die with their parent.
// No elevation, service, scheduled task, registry changes or renderer input.
internal static class WindowsUpdateHost {
    [STAThread]
    private static int Main(string[] args) {
        if (args.Length != 1 || args[0].Length == 0 || args[0].Length > 25000 ||
            !Regex.IsMatch(args[0], @"\A[A-Za-z0-9+/]+={0,2}\z")) return 2;
        try {
            Convert.FromBase64String(args[0]);
            string executable = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows),
                "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
            var options = new ProcessStartInfo(executable,
                "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand " + args[0]);
            options.UseShellExecute = false;
            options.CreateNoWindow = true;
            options.WindowStyle = ProcessWindowStyle.Hidden;
            using (Process child = Process.Start(options)) {
                child.WaitForExit();
                return child.ExitCode;
            }
        } catch { return 1; }
    }
}
