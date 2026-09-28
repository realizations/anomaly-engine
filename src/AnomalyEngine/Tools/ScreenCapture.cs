using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Windows.Forms;

namespace AnomalyEngine.Tools;

public static class ScreenCapture
{
    public static void Capture(string path)
    {
        var bounds = Screen.PrimaryScreen!.Bounds;
        using var bmp = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format32bppArgb);
        using var g = Graphics.FromImage(bmp);
        g.CopyFromScreen(bounds.X, bounds.Y, 0, 0, bounds.Size, CopyPixelOperation.SourceCopy);
        bmp.Save(path, ImageFormat.Png);
        Console.WriteLine($"Saved: {path} ({bounds.Width}x{bounds.Height})");
    }
}
