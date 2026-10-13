using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace AnomalyEngine.Core;

/// <summary>
/// Reads world definitions out of a folder on disk.
///
/// This is the other half of <c>livingwall world install</c>, which has always
/// written to <c>%APPDATA%\AnomalyEngine\worlds</c>. Nothing read that directory, so
/// every world installed through the command line was a folder the engine never opened
/// and the settings window never listed. The command reported success.
///
/// Worlds are data rather than code, which is what makes a folder possible: the
/// renderer registers definitions from JSON over the existing
/// <c>anomaly:worlds</c> channel and never has to be told where they came from. That
/// path already existed for the settings window's import box. This is the same path
/// with a directory in front of it.
///
/// Validation is deliberately strict and deliberately duplicated. The renderer's
/// <c>WorldDefinition</c> type is TypeScript, so the field list here is a second
/// transcription of it, and two transcriptions of one schema is exactly how a
/// validator starts rejecting valid worlds or accepting invalid ones.
/// <c>tools/verify-world-schema.mjs</c> asserts this list against the TypeScript
/// interface, so a field added to one and not the other fails the build rather than
/// failing on a user's machine.
/// </summary>
public sealed class WorldFolder
{
    /// <summary>Ceiling on definitions read from one folder.</summary>
    public const int MaxWorlds = 200;

    /// <summary>
    /// Fields the renderer requires. Mirrors the non-optional members of
    /// <c>WorldDefinition</c> in src/Engine/src/worlds/types.ts.
    /// </summary>
    public static readonly string[] RequiredFields =
    {
        "id", "name", "version", "engine", "description", "biome", "terrain",
    };

    /// <summary>
    /// The id pattern, character for character the renderer's own.
    ///
    /// Transcribed rather than shared because the two are in different languages, and a
    /// first attempt used `^[a-z0-9]+(-[a-z0-9]+)*$`, which is a *stricter* rule: it
    /// rejects `a--b` where the renderer accepts it. A validator that refuses a valid
    /// world is its own bug, and the only way to know is to check the two agree.
    /// `tools/verify-world-schema.mjs` compares these two strings.
    /// </summary>
    public const string IdPattern = @"^[a-z0-9]([a-z0-9-]*[a-z0-9])?$";

    private static readonly Regex IdRegex = new(IdPattern, RegexOptions.Compiled);

    /// <summary>
    /// The biome ids the renderer knows.
    ///
    /// Checked here because an unrecognised biome is not a warning: the renderer falls
    /// back to a default terrain and the world silently looks like a different place,
    /// which is worse than a refusal. Mirrors <c>BIOMES</c> in
    /// <c>src/Engine/src/worlds/types.ts</c>; <c>tools/verify-world-schema.mjs</c>
    /// asserts the two lists agree.
    /// </summary>
    public static readonly string[] Biomes =
    {
        "temperate-forest", "alpine", "coast", "high-desert", "salt-marsh", "liminal-interior",
    };

    /// <summary>Ceiling on the version of the format this validator understands.</summary>
    public const string EngineVersion = "0.1";

    public sealed record Result(string? Json, IReadOnlyList<string> Problems);

    /// <summary>
    /// Validates one world definition document.
    ///
    /// Returns the fields that are wrong rather than throwing, because the caller is
    /// usually a person who wrote the world and who needs to be told which part is
    /// wrong. A single combined boolean would only tell them that it is not valid.
    /// </summary>
    public static Result Validate(string json)
    {
        var problems = new List<string>();

        JsonElement root;
        try
        {
            using var doc = JsonDocument.Parse(json);
            root = doc.RootElement.Clone();
        }
        catch (JsonException ex)
        {
            return new Result(null, new[] { $"not valid JSON: {ex.Message}" });
        }

        if (root.ValueKind != JsonValueKind.Object)
        {
            return new Result(null, new[] { "the document is not a JSON object" });
        }

        foreach (var field in RequiredFields)
        {
            if (!root.TryGetProperty(field, out _))
            {
                problems.Add($"missing required field '{field}'");
            }
        }

        // The id is a save-file key and a URL fragment in the settings window, so it has
        // to be a restricted shape. Accepting anything here means a world called
        // "../evil" is a directory traversal waiting to happen in the folder loader and
        // a state file that cannot be edited by hand.
        if (root.TryGetProperty("id", out var id))
        {
            if (id.ValueKind != JsonValueKind.String || !IdRegex.IsMatch(id.GetString() ?? ""))
            {
                problems.Add("'id' must be lowercase kebab-case, e.g. 'saltwick'");
            }
        }

        if (root.TryGetProperty("terrain", out var terrain) &&
            terrain.ValueKind == JsonValueKind.Object &&
            !terrain.TryGetProperty("seed", out _))
        {
            problems.Add("missing required field 'terrain.seed'");
        }

        // An unknown biome is not a warning. The renderer falls back to a default
        // terrain and the world then looks like a different place, which is worse than
        // refusing it: the person who wrote it finds out from the screenshot.
        if (root.TryGetProperty("biome", out var biome) && biome.ValueKind == JsonValueKind.String)
        {
            var value = biome.GetString() ?? "";
            if (!Array.Exists(Biomes, b => b == value))
            {
                problems.Add($"unknown biome '{value}'; expected one of {string.Join(", ", Biomes)}");
            }
        }

        // `engine` is a minimum major version, so a world asking for a newer engine is
        // refused rather than loaded on the assumption that the parts it uses are
        // additive. Nothing has shipped a second major yet, which is exactly why this
        // check has never fired.
        if (root.TryGetProperty("engine", out var engine) && engine.ValueKind == JsonValueKind.String)
        {
            var value = engine.GetString() ?? "";
            if (!System.Version.TryParse(value, out var parsed))
            {
                problems.Add($"'engine' is not a version: '{value}'");
            }
            else if (parsed.Major > 0)
            {
                problems.Add(
                    $"'engine' asks for {value}, but this build understands {EngineVersion} only");
            }
        }

        return new Result(problems.Count == 0 ? json : null, problems);
    }

    /// <summary>
    /// Reads every <c>.json</c> world in a folder, reporting each one's problems.
    ///
    /// A broken file does not stop the others loading. The alternative is that one
    /// half-finished world makes every installed world disappear, which is a much worse
    /// failure than a warning.
    /// </summary>
    public static (IReadOnlyList<string> Worlds, IReadOnlyList<string> Problems) Load(string directory)
    {
        var worlds = new List<string>();
        var problems = new List<string>();

        if (!Directory.Exists(directory)) return (worlds, problems);

        var files = Directory.GetFiles(directory, "*.json", SearchOption.TopDirectoryOnly);
        Array.Sort(files, StringComparer.OrdinalIgnoreCase);

        if (files.Length > MaxWorlds)
        {
            problems.Add(
                $"the folder holds {files.Length} worlds, more than the {MaxWorlds} this will load; " +
                "the rest were ignored");
            files = files.Take(MaxWorlds).ToArray();
        }

        foreach (var file in files)
        {
            string json;
            try
            {
                json = File.ReadAllText(file);
            }
            catch (IOException ex)
            {
                problems.Add($"{Path.GetFileName(file)}: could not be read ({ex.Message})");
                continue;
            }

            var result = Validate(json);
            var name = Path.GetFileName(file);
            if (result.Problems.Count > 0)
            {
                problems.Add($"{name}: {string.Join("; ", result.Problems)}");
                continue;
            }
            worlds.Add(result.Json!);
        }

        return (worlds, problems);
    }

    /// <summary>The folder the host and the command line agree on.</summary>
    public static string DefaultDirectory => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "AnomalyEngine",
        "worlds");

    /// <summary>
    /// Builds the JSON array the renderer registers.
    ///
    /// Built by concatenating validated documents rather than by deserialising into a
    /// dictionary and re-serialising: System.Text.Json would drop or reorder members it
    /// does not know about, and a world definition carrying an unknown key should reach
    /// the renderer unchanged so the renderer's own validation is the one that decides.
    /// </summary>
    public static string ToArrayJson(IEnumerable<string> worlds)
        => "[" + string.Join(",", worlds) + "]";
}