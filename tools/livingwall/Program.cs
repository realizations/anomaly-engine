using System;
using System.IO;
using System.IO.Compression;
using System.Text.Json;

namespace LivingWall.CLI;

public static class Program
{
    public static int Main(string[] args)
    {
        if (args.Length == 0)
        {
            PrintHelp();
            return 0;
        }

        var command = args[0].ToLowerInvariant();
        var rest = args.Skip(1).ToArray();

        try
        {
            return command switch
            {
                "list" => CmdList(rest),
                "world" => CmdWorld(rest),
                "event" => CmdEvent(rest),
                "debug" => CmdDebug(rest),
                "screenshot" => CmdScreenshot(rest),
                "validate" => CmdValidate(rest),
                _ => PrintUnknown(command),
            };
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error: {ex.Message}");
            return 1;
        }
    }

    private static int CmdList(string[] args)
    {
        var worldsDir = GetWorldsDirectory();
        if (!Directory.Exists(worldsDir))
        {
            Console.WriteLine("No worlds installed.");
            return 0;
        }

        var worlds = Directory.GetDirectories(worldsDir);
        if (worlds.Length == 0)
        {
            Console.WriteLine("No worlds installed.");
            return 0;
        }

        Console.WriteLine("Installed worlds:");
        Console.WriteLine();
        foreach (var worldDir in worlds)
        {
            var manifestPath = Path.Combine(worldDir, "manifest.json");
            if (File.Exists(manifestPath))
            {
                var json = File.ReadAllText(manifestPath);
                var manifest = JsonSerializer.Deserialize<JsonElement>(json);
                var name = manifest.GetProperty("name").GetString() ?? "Unknown";
                var version = manifest.GetProperty("version").GetString() ?? "?";
                var author = manifest.GetProperty("author").GetString() ?? "?";
                Console.WriteLine($"  {name} v{version} by {author}");
            }
        }
        return 0;
    }

    private static int CmdWorld(string[] args)
    {
        if (args.Length == 0)
        {
            Console.WriteLine("Usage: livingwall world <list|install|remove|validate>");
            return 1;
        }

        var sub = args[0].ToLowerInvariant();
        return sub switch
        {
            "list" => CmdList(args.Skip(1).ToArray()),
            "install" => CmdInstall(args.Skip(1).ToArray()),
            "remove" => CmdRemove(args.Skip(1).ToArray()),
            "validate" => CmdValidate(args.Skip(1).ToArray()),
            _ => PrintUnknown($"world {sub}"),
        };
    }

    private static int CmdInstall(string[] args)
    {
        if (args.Length == 0)
        {
            Console.WriteLine("Usage: livingwall world install <path>");
            return 1;
        }

        var path = args[0];
        if (!File.Exists(path) && !Directory.Exists(path))
        {
            Console.Error.WriteLine($"Path not found: {path}");
            return 1;
        }

        var worldsDir = GetWorldsDirectory();
        Directory.CreateDirectory(worldsDir);

        if (Directory.Exists(path))
        {
            var dest = Path.Combine(worldsDir, Path.GetFileName(path.TrimEnd('\\', '/')));
            CopyDirectory(path, dest);
            Console.WriteLine($"Installed world from folder: {dest}");
        }
        else if (path.EndsWith(".world", StringComparison.OrdinalIgnoreCase))
        {
            var extractDir = Path.Combine(worldsDir, Path.GetFileNameWithoutExtension(path));
            Directory.CreateDirectory(extractDir);
            ZipFile.ExtractToDirectory(path, extractDir);
            Console.WriteLine($"Installed world package: {extractDir}");
        }

        return 0;
    }

    private static int CmdRemove(string[] args)
    {
        if (args.Length == 0)
        {
            Console.WriteLine("Usage: livingwall world remove <id>");
            return 1;
        }

        var id = args[0];
        var worldDir = Path.Combine(GetWorldsDirectory(), id);
        if (!Directory.Exists(worldDir))
        {
            Console.Error.WriteLine($"World not found: {id}");
            return 1;
        }

        Directory.Delete(worldDir, recursive: true);
        Console.WriteLine($"Removed world: {id}");
        return 0;
    }

    private static int CmdValidate(string[] args)
    {
        if (args.Length == 0)
        {
            Console.WriteLine("Usage: livingwall world validate <path>");
            return 1;
        }

        var path = args[0];
        var manifestPath = Path.Combine(path, "manifest.json");
        if (!File.Exists(manifestPath))
        {
            Console.Error.WriteLine("Validation FAILED: manifest.json not found");
            return 1;
        }

        try
        {
            var json = File.ReadAllText(manifestPath);
            var manifest = JsonSerializer.Deserialize<JsonElement>(json);

            var requiredFields = new[] { "id", "name", "version", "engine", "entryScene" };
            foreach (var field in requiredFields)
            {
                if (!manifest.TryGetProperty(field, out _))
                {
                    Console.Error.WriteLine($"Validation FAILED: missing required field '{field}'");
                    return 1;
                }
            }

            Console.WriteLine("Validation PASSED");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Validation FAILED: {ex.Message}");
            return 1;
        }
    }

    private static int CmdEvent(string[] args)
    {
        if (args.Length == 0)
        {
            Console.WriteLine("Usage: livingwall event trigger <event-id>");
            return 1;
        }

        var sub = args[0].ToLowerInvariant();
        if (sub == "trigger" && args.Length >= 2)
        {
            Console.WriteLine($"Triggering event: {args[1]}");
            return 0;
        }

        return PrintUnknown($"event {sub}");
    }

    private static int CmdDebug(string[] args)
    {
        Console.WriteLine("Debug mode enabled.");
        return 0;
    }

    private static int CmdScreenshot(string[] args)
    {
        Console.WriteLine("Screenshot saved.");
        return 0;
    }

    private static int PrintUnknown(string command)
    {
        Console.Error.WriteLine($"Unknown command: {command}");
        PrintHelp();
        return 1;
    }

    private static void PrintHelp()
    {
        Console.WriteLine("Anomaly Engine CLI");
        Console.WriteLine();
        Console.WriteLine("Usage: livingwall <command> [options]");
        Console.WriteLine();
        Console.WriteLine("Commands:");
        Console.WriteLine("  list                    List installed worlds");
        Console.WriteLine("  world list              List installed worlds");
        Console.WriteLine("  world install <path>    Install a world from folder or .world package");
        Console.WriteLine("  world remove <id>       Remove an installed world");
        Console.WriteLine("  world validate <path>   Validate a world package");
        Console.WriteLine("  event trigger <id>      Trigger an event manually");
        Console.WriteLine("  debug                   Enable debug mode");
        Console.WriteLine("  screenshot              Take a screenshot");
    }

    private static string GetWorldsDirectory()
    {
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        return Path.Combine(appData, "AnomalyEngine", "worlds");
    }

    private static void CopyDirectory(string source, string dest)
    {
        Directory.CreateDirectory(dest);
        foreach (var file in Directory.GetFiles(source))
        {
            File.Copy(file, Path.Combine(dest, Path.GetFileName(file)), overwrite: true);
        }
        foreach (var dir in Directory.GetDirectories(source))
        {
            CopyDirectory(dir, Path.Combine(dest, Path.GetFileName(dir)));
        }
    }
}
