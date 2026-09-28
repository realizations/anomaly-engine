using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

namespace AnomalyEngine.Core;

public static class IconGenerator
{
    public static void EnsureIconExists()
    {
        var iconPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "anomaly.ico");

        if (File.Exists(iconPath)) return;

        try
        {
            using var bitmap = CreateBitmap(64, 64);
            var handle = bitmap.GetHicon();
            using var icon = Icon.FromHandle(handle);
            using var fs = new FileStream(iconPath, FileMode.Create);
            icon.Save(fs);
        }
        catch
        {
            if (File.Exists(iconPath)) File.Delete(iconPath);
        }
    }

    private static Bitmap CreateBitmap(int width, int height)
    {
        var bmp = new Bitmap(width, height, PixelFormat.Format32bppArgb);
        using var g = Graphics.FromImage(bmp);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;

        var size = Math.Min(width, height);

        using (var bg = new LinearGradientBrush(
            new Rectangle(0, 0, width, height),
            Color.FromArgb(255, 12, 14, 38),
            Color.FromArgb(255, 46, 32, 78),
            LinearGradientMode.Vertical))
        {
            g.FillEllipse(bg, 0, 0, width, height);
        }

        using (var moon = new SolidBrush(Color.FromArgb(255, 226, 230, 255)))
        {
            g.FillEllipse(moon, size * 0.28f, size * 0.22f, size * 0.44f, size * 0.44f);
        }

        using (var bite = new SolidBrush(Color.FromArgb(255, 22, 20, 48)))
        {
            g.FillEllipse(bite, size * 0.40f, size * 0.19f, size * 0.44f, size * 0.44f);
        }

        using (var tree = new SolidBrush(Color.FromArgb(255, 18, 74, 40)))
        {
            for (int i = 0; i < 5; i++)
            {
                float x = size * (0.14f + i * 0.18f);
                float h = size * (0.32f + (i % 2) * 0.10f);
                g.FillPolygon(tree, new[]
                {
                    new PointF(x, size * 0.95f - h),
                    new PointF(x - size * 0.10f, size * 0.95f),
                    new PointF(x + size * 0.10f, size * 0.95f),
                });
            }
        }

        return bmp;
    }
}
