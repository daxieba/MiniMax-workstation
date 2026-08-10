// 7za.exe wrapper for electron-builder 25.1.8 on Windows.
// electron-builder hardcodes -snld which 7-Zip never supported
// (only -snl exists, which actually CREATES symlinks on Windows).
// Real 7za lives at 7za-real.exe next to this wrapper.
// We translate -snld into -xr!darwin -xr!linux (7-Zip 21.07 / 26.02 both support it)
// to skip the cross-platform darwin / linux subdirs that contain broken symlinks.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;

class Wrapper
{
    static int Main(string[] args)
    {
        try
        {
            var newArgs = new List<string>();
            bool substituted = false;
            foreach (var a in args)
            {
                if (string.Equals(a, "-snld", StringComparison.OrdinalIgnoreCase))
                {
                    if (!substituted)
                    {
                        newArgs.Add("-xr!darwin");
                        newArgs.Add("-xr!linux");
                        substituted = true;
                    }
                }
                else
                {
                    newArgs.Add(a);
                }
            }

            var wrapperDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            var realExe = Path.Combine(wrapperDir ?? ".", "7za-real.exe");
            if (!File.Exists(realExe))
            {
                Console.Error.WriteLine("7za wrapper: real binary not found at " + realExe);
                return 1;
            }

            var psi = new ProcessStartInfo
            {
                FileName = realExe,
                UseShellExecute = false,
                CreateNoWindow = false,
            };
            var quoted = new List<string>();
            foreach (var a in newArgs)
            {
                quoted.Add("\"" + a.Replace("\"", "\\\"") + "\"");
            }
            psi.Arguments = string.Join(" ", quoted);

            try
            {
                var dbgPath = Path.Combine(wrapperDir ?? ".", "7za-wrapper.log");
                File.AppendAllText(dbgPath, DateTime.Now.ToString("HH:mm:ss.fff") + " " + realExe + " " + psi.Arguments + Environment.NewLine);
            }
            catch { }

            var p = Process.Start(psi);
            if (p == null) return 1;
            p.WaitForExit();
            return p.ExitCode;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("7za wrapper: " + ex.Message);
            return 1;
        }
    }
}
