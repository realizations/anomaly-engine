using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using AnomalyEngine.Core;

namespace LivingWall.CLI;

/// <summary>
/// The Anomaly Engine command line.
///
/// Three of these commands used to print a success message and return zero without
/// doing anything: <c>event trigger</c>, <c>debug</c> and <c>screenshot</c>. A command
/// that reports success it did not achieve is worse than one that does not exist,
/// because a script driving it concludes that the trigger worked.
/// <c>world install</c> was subtler and worse: it copied files into
/// <c>%APPDATA%\AnomalyEngine\worlds</c> and nothing in the product ever read that
/// directory. It now does, in <c>WorldFolder</c>, and <c>world validate</c> checked a
/// <c>manifest.json</c> schema the world format does not have -- including an
/// <c>entryScene</c> field and no <c>terrain</c> -- so it rejected every world that
/// would actually load and accepted documents that would not.
/// </summary>
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
                "list" => CmdList(),
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

    private static int CmdList()
    {
        var worldsDir = WorldsDirectory();
        if (!Directory.Exists(worldsDir))
        {
            Console.WriteLine("No worlds installed.");
            return 0;
        }

        var files = Directory.GetFiles(worldsDir, "*.json", SearchOption.TopDirectoryOnly);
        if (files.Length == 0)
        {
            Console.WriteLine("No worlds installed.");
            return 0;
        }

        Console.WriteLine("Installed worlds:");
        Console.WriteLine();

        var broken = 0;
        foreach (var file in files.OrderBy(f => f, StringComparer.OrdinalIgnoreCase))
        {
            var name = Path.GetFileName(file);
            var check = WorldFolder.Validate(File.ReadAllText(file));
            if (check.Problems.Count > 0)
            {
                broken++;
                Console.WriteLine($"  {name,-28} invalid: {check.Problems[0]}");
                continue;
            }

            using var doc = System.Text.Json.JsonDocument.Parse(check.Json!);
            var root = doc.RootElement;
            var author = root.TryGetProperty("author", out var a) ? a.GetString() : "?";
            Console.WriteLine(
                $"  {root.GetProperty("id").GetString(),-28} " +
                $"{root.GetProperty("name").GetString()} " +
                $"v{root.GetProperty("version").GetString()} " +
                $"by {author}");
        }

        // Non-zero when something is wrong, because "list" is the command a person runs
        // when something is not working.
        return broken == 0 ? 0 : 2;
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
            "list" => CmdList(),
            "install" => CmdInstall(args.Skip(1).ToArray()),
            "remove" => CmdRemove(args.Skip(1).ToArray()),
            "validate" => CmdValidate(args.Skip(1).ToArray()),
            _ => PrintUnknown($"world {sub}"),
        };
    }

    /// <summary>
    /// Installs a world from a definition file, a folder, or a <c>.world</c> package.
    ///
    /// The world is validated before it is copied rather than after, so a failed
    /// install leaves nothing behind. The alternative is a half-installed world the
    /// engine skips on every start, which looks like an engine bug.
    /// </summary>
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

        var worldsDir = WorldsDirectory();
        Directory.CreateDirectory(worldsDir);

        if (Directory.Exists(path))
        {
            var files = Directory.GetFiles(path, "*.json", SearchOption.TopDirectoryOnly);
            if (files.Length == 0)
            {
                Console.Error.WriteLine($"No .json world definitions in {path}");
                return 1;
            }
            foreach (var file in files)
            {
                var code = InstallOne(File.ReadAllText(file), worldsDir, Path.GetFileName(file));
                if (code != 0) return code;
            }
            Console.WriteLine($"Installed {files.Length} world(s) from {path}");
            return 0;
        }

        if (path.EndsWith(".world", StringComparison.OrdinalIgnoreCase))
        {
            // A package is a zip of definitions. Extracted to a temp directory and
            // validated there, so a malformed package cannot fill the worlds folder
            // with files before being found to be broken.
            var temp = Path.Combine(Path.GetTempPath(), "livingwall-" + Guid.NewGuid().ToString("N"));
            try
            {
                ZipFile.ExtractToDirectory(path, temp);
                var files = Directory.GetFiles(temp, "*.json", SearchOption.AllDirectories);
                if (files.Length == 0)
                {
                    Console.Error.WriteLine($"The package {path} contains no world definitions.");
                    return 1;
                }
                foreach (var file in files)
                {
                    var code = InstallOne(File.ReadAllText(file), worldsDir, Path.GetFileName(file));
                    if (code != 0) return code;
                }
                Console.WriteLine($"Installed {files.Length} world(s) from {path}");
                return 0;
            }
            finally
            {
                if (Directory.Exists(temp)) Directory.Delete(temp, recursive: true);
            }
        }

        // A bare .json definition.
        var installCode = InstallOne(File.ReadAllText(path), worldsDir, Path.GetFileName(path));
        if (installCode != 0) return installCode;
        Console.WriteLine($"Installed from {path}");
        return 0;
    }

    /// <summary>
    /// Validates and writes one definition, named after its own id rather than after
    /// the file it came from.
    ///
    /// The file name matters after this: <c>remove</c> takes an id, the settings
    /// window lists ids, and a world installed as <c>MyWorld.json</c> would then be
    /// impossible to remove by id. One naming rule, applied here, is cheaper than
    /// remembering the mapping everywhere.
    /// </summary>
    private static int InstallOne(string json, string worldsDir, string originName)
    {
        var check = WorldFolder.Validate(json);
        if (check.Problems.Count > 0)
        {
            Console.Error.WriteLine($"Validation FAILED for {originName}:");
            foreach (var problem in check.Problems) Console.Error.WriteLine($"  {problem}");
            return 1;
        }

        using var doc = System.Text.Json.JsonDocument.Parse(check.Json!);
        var id = doc.RootElement.GetProperty("id").GetString()!;
        var dest = Path.Combine(worldsDir, id + ".json");
        File.WriteAllText(dest, check.Json!);
        Console.WriteLine($"Installed {id} -> {dest}");
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
        var path = Path.Combine(WorldsDirectory(), id + ".json");

        // Refuses anything that is not a bare id. `remove ..\..\` with a directory-shaped
        // argument and Directory.Delete(recursive: true) is a foot-gun in a tool people
        // paste paths into.
        if (id.Contains(Path.DirectorySeparatorChar) || id.Contains('/') || id.Contains(".."))
        {
            Console.Error.WriteLine($"Not a world id: {id}");
            return 1;
        }

        if (!File.Exists(path))
        {
            Console.Error.WriteLine($"World not found: {id}");
            return 1;
        }

        File.Delete(path);
        Console.WriteLine($"Removed world: {id}");
        return 0;
    }

    /// <summary>
    /// Validates a world definition file, folder or package.
    ///
    /// Against <c>WorldFolder</c>, the same validator the engine uses to decide what to
    /// load. A second implementation here is how this command came to require a
    /// <c>manifest.json</c> and an <c>entryScene</c> that no world has.
    /// </summary>
    private static int CmdValidate(string[] args)
    {
        if (args.Length == 0)
        {
            Console.WriteLine("Usage: livingwall world validate <path>");
            return 1;
        }

        var path = args[0];
        var files = new List<string>();

        if (Directory.Exists(path))
        {
            files.AddRange(Directory.GetFiles(path, "*.json", SearchOption.AllDirectories));
        }
        else if (File.Exists(path))
        {
            if (path.EndsWith(".world", StringComparison.OrdinalIgnoreCase))
            {
                Console.Error.WriteLine(
                    "A .world package is a zip archive; extract it and validate the folder inside it.");
                return 1;
            }
            files.Add(path);
        }
        else
        {
            Console.Error.WriteLine($"Path not found: {path}");
            return 1;
        }

        if (files.Count == 0)
        {
            Console.Error.WriteLine($"No .json world definitions in {path}");
            return 1;
        }

        var failed = 0;
        foreach (var file in files.OrderBy(f => f, StringComparer.OrdinalIgnoreCase))
        {
            var check = WorldFolder.Validate(File.ReadAllText(file));
            if (check.Problems.Count == 0)
            {
                Console.WriteLine($"PASS  {Path.GetFileName(file)}");
                continue;
            }
            failed++;
            Console.Error.WriteLine($"FAIL  {Path.GetFileName(file)}");
            foreach (var problem in check.Problems) Console.Error.WriteLine($"      {problem}");
        }

        return failed == 0 ? 0 : 1;
    }

    /// <summary>
    /// Triggers an event, by starting the engine with <c>--trigger</c>.
    ///
    /// The alternative is a message to a running instance, which needs a named pipe or
    /// a window message: real work, and the wrong trade for a command whose whole job is
    /// "make one anomaly happen now". Starting the engine is honest, works whether or
    /// not the tray is up, and needs no second process to stay resident.
    /// </summary>
    private static int CmdEvent(string[] args)
    {
        if (args.Length == 0)
        {
            Console.WriteLine("Usage: livingwall event trigger <event-id>");
            return 1;
        }

        var sub = args[0].ToLowerInvariant();
        if (sub != "trigger")
        {
            return PrintUnknown($"event {sub}");
        }

        if (args.Length < 2)
        {
            Console.Error.WriteLine("Usage: livingwall event trigger <event-id>");
            return 1;
        }

        return RunEngine("--trigger", args[1]);
    }

    /// <summary>
    /// Starts the engine with the debug overlay already on.
    ///
    /// The overlay used to be reachable only from the tray, so there was no way to get
    /// it without a mouse. <c>--debug</c> opens it at start-up; the same reason as
    /// <c>event trigger</c> applies.
    /// </summary>
    private static int CmdDebug(string[] args)
    {
        if (args.Contains("--off"))
        {
            Console.Error.WriteLine("The debug overlay cannot be switched off from here; it is per-session.");
            return 1;
        }

        return RunEngine("--debug");
    }

    /// <summary>Captures the desktop to a PNG through the engine's own capture path.</summary>
    private static int CmdScreenshot(string[] args)
    {
        var path = args.FirstOrDefault(a => !a.StartsWith("-", StringComparison.Ordinal))
            ?? Path.Combine(Environment.CurrentDirectory, "anomaly-engine.png");

        return RunEngine("--capture", path);
    }

    /// <summary>
    /// Runs the engine binary with arguments and forwards its exit code.
    ///
    /// The path is resolved next to this executable first, then on <c>PATH</c>, because
    /// the two usual ways to run the CLI are from the publish folder and from a
    /// globally-installed copy. When neither has it, that is reported as an error rather
    /// than as a silent no-op.
    /// </summary>
    private static int RunEngine(params string[] arguments)
    {
        var exe = ResolveEnginePath();
        if (exe is null)
        {
            Console.Error.WriteLine(
                "Could not find AnomalyEngine.exe. Run this from a build or publish folder, " +
                "or put AnomalyEngine.exe on PATH.");
            return 1;
        }

        Console.WriteLine($"Starting the engine: {Path.GetFileName(exe)} {string.Join(' ', arguments)}");
        var psi = new ProcessStartInfo(exe)
        {
            UseShellExecute = false,
            WorkingDirectory = Path.GetDirectoryName(exe) ?? Environment.CurrentDirectory,
        };
        foreach (var argument in arguments) psi.ArgumentList.Add(argument);

        try
        {
            using var process = Process.Start(psi);
            if (process is null)
            {
                Console.Error.WriteLine("The engine process did not start.");
                return 1;
            }
            process.WaitForExit();
            return process.ExitCode;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Could not start the engine: {ex.Message}");
            return 1;
        }
    }

    private static string? ResolveEnginePath()
    {
        var name = OperatingSystem.IsWindows() ? "AnomalyEngine.exe" : "AnomalyEngine";
        var beside = Path.Combine(AppContext.BaseDirectory, name);
        if (File.Exists(beside)) return beside;

        var found = SearchPath(name);
        return found;
    }

    private static string? SearchPath(string name)
    {
        var path = Environment.GetEnvironmentVariable("PATH");
        if (path is null) return null;
        foreach (var dir in path.Split(Path.PathSeparator))
        {
            if (dir.Length == 0) continue;
            try
            {
                var candidate = Path.Combine(dir.Trim(), name);
                if (File.Exists(candidate)) return candidate;
            }
            catch (ArgumentException)
            {
                // A malformed PATH entry is not this command's problem.
            }
        }
        return null;
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
        Console.WriteLine("  list                    List installed worlds, marking invalid ones");
        Console.WriteLine("  world list              The same as list");
        Console.WriteLine("  world install <path>    Install a world from a .json file, a folder, or a .world package");
        Console.WriteLine("  world remove <id>       Remove an installed world");
        Console.WriteLine("  world validate <path>   Validate a world definition, and say which field is wrong");
        Console.WriteLine("  event trigger <id>      Start the engine and fire that event");
        Console.WriteLine("  debug                   Start the engine with the debug overlay on");
        Console.WriteLine("  screenshot [path]       Capture the desktop to a PNG");
        Console.WriteLine();
        Console.WriteLine("Worlds are read from %APPDATA%\\AnomalyEngine\\worlds and re-read when that folder changes.");
    }

    /// <summary>
    /// The worlds folder.
    ///
    /// Calls into the engine assembly rather than repeating the path, because the CLI
    /// and the host have to agree on it and two literals are two chances to disagree --
    /// which is how <c>install</c> came to write somewhere nothing read.
    /// </summary>
    private static string WorldsDirectory() => AnomalyEngine.Core.WorldFolder.DefaultDirectory;
}