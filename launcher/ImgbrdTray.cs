using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace Imgbrd
{
  static class Program
  {
    const int Port = 4178;
    static Process _server;
    static IntPtr _job;

    [STAThread]
    static void Main()
    {
      bool created;
      using (new Mutex(true, "Local\\imgbrd-tray", out created))
      {
        if (!created)
        {
          OpenBrowser();
          return;
        }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        string node = FindNode();
        if (node == null)
        {
          MessageBox.Show(
            "Node.js was not found.",
            "imgbrd",
            MessageBoxButtons.OK,
            MessageBoxIcon.Error);
          return;
        }
        if (!File.Exists(Path.Combine(root, "dist", "index.html")))
        {
          MessageBox.Show(
            "The interface is missing. Run npm run exe once in the project folder.",
            "imgbrd",
            MessageBoxButtons.OK,
            MessageBoxIcon.Error);
          return;
        }

        var error = new StringBuilder();
        var psi = new ProcessStartInfo();
        psi.FileName = node;
        psi.Arguments = "server/index.js";
        psi.WorkingDirectory = root;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardError = true;
        psi.RedirectStandardOutput = true;
        psi.EnvironmentVariables["PORT"] = Port.ToString();

        try
        {
          _server = Process.Start(psi);
        }
        catch (Exception ex)
        {
          MessageBox.Show(ex.Message, "imgbrd", MessageBoxButtons.OK, MessageBoxIcon.Error);
          return;
        }

        _server.OutputDataReceived += delegate { };
        _server.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e)
        {
          if (e.Data != null) error.AppendLine(e.Data);
        };
        _server.BeginOutputReadLine();
        _server.BeginErrorReadLine();
        TryBindJob(_server);

        bool ready = WaitForPort(10000);
        if (_server.HasExited || !ready)
        {
          string detail = error.Length > 0 ? error.ToString() : "The server did not start.";
          MessageBox.Show(detail, "imgbrd", MessageBoxButtons.OK, MessageBoxIcon.Error);
          KillServer();
          return;
        }

        NotifyIcon icon = new NotifyIcon();
        icon.Icon = MakeIcon();
        icon.Text = "imgbrd";
        icon.Visible = true;

        ContextMenuStrip menu = new ContextMenuStrip();
        menu.Items.Add("Open in browser", null, delegate { OpenBrowser(); });
        menu.Items.Add("Quit", null, delegate { Shutdown(icon); });
        icon.ContextMenuStrip = menu;
        icon.DoubleClick += delegate { OpenBrowser(); };
        icon.ShowBalloonTip(3000, "imgbrd", "Running in the background. Right-click to quit.", ToolTipIcon.Info);

        OpenBrowser();
        Application.ApplicationExit += delegate
        {
          KillServer();
          icon.Visible = false;
          icon.Dispose();
        };
        Application.Run();
      }
    }

    static void Shutdown(NotifyIcon icon)
    {
      KillServer();
      icon.Visible = false;
      icon.Dispose();
      Application.Exit();
    }

    static void KillServer()
    {
      try
      {
        if (_server != null && !_server.HasExited) _server.Kill();
      }
      catch { }
    }

    static void OpenBrowser()
    {
      Process.Start(new ProcessStartInfo("http://127.0.0.1:" + Port + "/") { UseShellExecute = true });
    }

    static bool WaitForPort(int timeoutMs)
    {
      var watch = Stopwatch.StartNew();
      while (watch.ElapsedMilliseconds < timeoutMs)
      {
        try
        {
          using (var client = new TcpClient())
          {
            var task = client.ConnectAsync("127.0.0.1", Port);
            if (task.Wait(300) && client.Connected) return true;
          }
        }
        catch { }
        Thread.Sleep(200);
      }
      return false;
    }

    static string FindNode()
    {
      try
      {
        var where = new ProcessStartInfo("where.exe", "node");
        where.UseShellExecute = false;
        where.CreateNoWindow = true;
        where.RedirectStandardOutput = true;
        using (var proc = Process.Start(where))
        {
          string output = proc.StandardOutput.ReadToEnd();
          proc.WaitForExit();
          foreach (string line in output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries))
          {
            if (File.Exists(line.Trim())) return line.Trim();
          }
        }
      }
      catch { }

      string[] candidates = new[]
      {
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs", "node.exe"),
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "nodejs", "node.exe"),
      };
      foreach (string candidate in candidates)
      {
        if (File.Exists(candidate)) return candidate;
      }
      return null;
    }

    static Icon MakeIcon()
    {
      var bmp = new Bitmap(32, 32);
      using (var g = Graphics.FromImage(bmp))
      {
        g.Clear(Color.FromArgb(226, 165, 58));
        using (var font = new Font("Segoe UI", 13f, FontStyle.Bold, GraphicsUnit.Pixel))
        using (var brush = new SolidBrush(Color.FromArgb(36, 26, 8)))
        {
          var size = g.MeasureString("ib", font);
          g.DrawString("ib", font, brush, (32f - size.Width) / 2f, (32f - size.Height) / 2f);
        }
      }
      return Icon.FromHandle(bmp.GetHicon());
    }

    static void TryBindJob(Process process)
    {
      try
      {
        _job = CreateJobObject(IntPtr.Zero, null);
        var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        info.BasicLimitInformation.LimitFlags = 0x2000;
        int size = Marshal.SizeOf(info);
        IntPtr ptr = Marshal.AllocHGlobal(size);
        Marshal.StructureToPtr(info, ptr, false);
        SetInformationJobObject(_job, 9, ptr, (uint)size);
        Marshal.FreeHGlobal(ptr);
        AssignProcessToJobObject(_job, process.Handle);
      }
      catch { }
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr CreateJobObject(IntPtr attributes, string name);

    [DllImport("kernel32.dll")]
    static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);

    [DllImport("kernel32.dll")]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
      public long PerProcessUserTimeLimit;
      public long PerJobUserTimeLimit;
      public uint LimitFlags;
      public UIntPtr MinimumWorkingSetSize;
      public UIntPtr MaximumWorkingSetSize;
      public uint ActiveProcessLimit;
      public UIntPtr Affinity;
      public uint PriorityClass;
      public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct IO_COUNTERS
    {
      public ulong ReadOperationCount;
      public ulong WriteOperationCount;
      public ulong OtherOperationCount;
      public ulong ReadTransferCount;
      public ulong WriteTransferCount;
      public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
      public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
      public IO_COUNTERS IoInfo;
      public UIntPtr ProcessMemoryLimit;
      public UIntPtr JobMemoryLimit;
      public UIntPtr PeakProcessMemoryUsed;
      public UIntPtr PeakJobMemoryUsed;
    }
  }
}
