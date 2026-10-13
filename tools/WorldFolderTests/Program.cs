using System.Text.Json;
using AnomalyEngine.Core;

namespace WorldFolderTests;

/// <summary>
/// Runs <see cref="WorldFolder"/> against real files on disk and reports.
///
/// Written as a harness rather than a test framework because the project has no test
/// runner on the C# side and adding one to ship a validator that is nine fields would
/// be a larger change than the thing being verified. It exits non-zero on failure, so
/// the gate and CI treat it the same way as everything else.
/// </summary>
public static class Program
{
    private static int _failed;

    public static int Main()
    {
        var temp = Path.Combine(Path.GetTempPath(), "world-folder-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(temp);
        try
        {
            TestValidWorldPasses();
            TestMissingFieldIsNamed();
            TestUnknownBiomeIsRejected();
            TestIdPatternMatchesTheRenderer();
            TestTerrainSeedIsRequired();
            TestEngineVersionIsChecked();
            TestBrokenFileDoesNotStopTheOthers(temp);
            TestFolderCeilingIsReported(temp);
            TestArrayJsonIsWhatTheRendererExpects();
        }
        finally
        {
            if (Directory.Exists(temp)) Directory.Delete(temp, recursive: true);
        }

        Console.WriteLine(_failed == 0 ? "\nThe world validator behaves." : $"\n{_failed} check(s) failed.");
        return _failed == 0 ? 0 : 1;
    }

    /* ------------------------------ fixtures ------------------------------- */

    private static string World(
        string id = "saltwick",
        string biome = "salt-marsh",
        string engine = "0.1",
        bool withTerrain = true,
        bool withDescription = true)
    {
        var terrain = withTerrain ? "\"terrain\": { \"seed\": 2211 }," : "";
        var description = withDescription ? "\"description\": \"A flat white place.\"," : "";
        return $$"""
        {
          "id": "{{id}}",
          "name": "Saltwick",
          "author": "a test",
          "version": "0.1.0",
          "engine": "{{engine}}",
          {{description}}
          "biome": "{{biome}}",
          {{terrain}}
          "sky": { "cloudiness": 0.4 }
        }
        """;
    }

    /* ------------------------------- checks -------------------------------- */

    private static void TestValidWorldPasses()
        => Expect("a well-formed world validates", ok: WorldFolder.Validate(World()).Problems.Count == 0);

    /// <summary>
    /// The failure this whole harness exists for: a command that says "invalid" with no
    /// further detail is the command nobody runs twice.
    /// </summary>
    private static void TestMissingFieldIsNamed()
    {
        var result = WorldFolder.Validate(World(withDescription: false));
        Expect("a missing description is rejected", ok: result.Problems.Count > 0);
        Expect(
            "the problem names the field",
            ok: result.Problems.Any(p => p.Contains("description")));
    }

    private static void TestUnknownBiomeIsRejected()
    {
        var result = WorldFolder.Validate(World(biome: "mars"));
        Expect("an unknown biome is rejected", ok: result.Problems.Count > 0);
        Expect(
            "the problem lists the biomes that do exist",
            ok: result.Problems.Any(p => p.Contains("salt-marsh")));
    }

    /// <summary>
    /// The ids the renderer accepts, checked against the pattern the renderer uses.
    ///
    /// A CLI pattern stricter than the renderer's means `world validate` refuses
    /// worlds that would load, which is how this harness found the first version of
    /// the pattern. The cases below are the ones the two patterns disagreed on.
    /// </summary>
    private static void TestIdPatternMatchesTheRenderer()
    {
        foreach (var id in new[] { "a", "saltwick", "salt-wick", "a--b", "world2", "9lives" })
        {
            Expect($"the id '{id}' is accepted", ok: IdOk(World(id: id)));
        }
        foreach (var id in new[] { "-leading", "trailing-", "Upper", "with space", "with_underscore", "" })
        {
            Expect($"the id '{(id.Length == 0 ? "(empty)" : id)}' is rejected", ok: !IdOk(World(id: id)));
        }
    }

    private static bool IdOk(string json) => WorldFolder.Validate(json).Problems.Count == 0;

    private static void TestTerrainSeedIsRequired()
    {
        var missing = WorldFolder.Validate(World(withTerrain: false));
        Expect("a missing terrain is rejected", ok: missing.Problems.Count > 0);

        var noSeed = WorldFolder.Validate(
            """
            { "id": "x", "name": "X", "version": "1", "engine": "0.1",
              "description": "d", "biome": "coast", "terrain": {} }
            """);
        Expect(
            "a terrain with no seed is rejected",
            ok: noSeed.Problems.Any(p => p.Contains("terrain.seed")));
    }

    /// <summary>
    /// Nothing has ever shipped a second engine major, so this check has never fired
    /// and is exactly the kind that is wrong until it is right.
    /// </summary>
    private static void TestEngineVersionIsChecked()
    {
        Expect("engine 1.0 is refused", ok: !IdOk(World(engine: "1.0")));
        Expect(
            "the refusal says which version this build understands",
            ok: WorldFolder.Validate(World(engine: "1.0")).Problems.Any(p => p.Contains(WorldFolder.EngineVersion)));
        Expect(
            "an unparseable engine version is refused",
            ok: !IdOk(World(engine: "next")));
    }

    /// <summary>
    /// One broken file must not take the rest of the folder down with it. The
    /// alternative is that a half-finished world makes every installed world vanish,
    /// which is a much worse failure than a warning.
    /// </summary>
    private static void TestBrokenFileDoesNotStopTheOthers(string temp)
    {
        var dir = Path.Combine(temp, "mixed");
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "good-one.json"), World(id: "good-one"));
        File.WriteAllText(Path.Combine(dir, "broken.json"), "{ this is not json");
        File.WriteAllText(Path.Combine(dir, "bad-biome.json"), World(id: "bad-biome", biome: "mars"));

        var (worlds, problems) = WorldFolder.Load(dir);
        Expect("the good world still loads", ok: worlds.Count == 1);
        Expect("both bad files are reported", ok: problems.Count == 2);
        Expect(
            "each problem names its own file",
            ok: problems.Any(p => p.Contains("broken.json")) && problems.Any(p => p.Contains("bad-biome.json")));
    }

    private static void TestFolderCeilingIsReported(string temp)
    {
        var dir = Path.Combine(temp, "many");
        Directory.CreateDirectory(dir);
        for (var i = 0; i < WorldFolder.MaxWorlds + 5; i++)
        {
            File.WriteAllText(Path.Combine(dir, $"w{i}.json"), World(id: $"w{i}"));
        }

        var (worlds, problems) = WorldFolder.Load(dir);
        Expect($"no more than {WorldFolder.MaxWorlds} worlds load", ok: worlds.Count == WorldFolder.MaxWorlds);
        Expect("the excess is reported rather than ignored", ok: problems.Any(p => p.Contains("more than")));
    }

    /// <summary>
    /// The array has to be the shape the renderer's `JSON.parse` expects, and the
    /// renderer re-validates: this is a transport, not a second opinion.
    /// </summary>
    private static void TestArrayJsonIsWhatTheRendererExpects()
    {
        var array = WorldFolder.ToArrayJson(new[] { World(id: "one"), World(id: "two") });
        using var doc = JsonDocument.Parse(array);
        Expect("the payload parses as JSON", ok: true);
        Expect("it is an array", ok: doc.RootElement.ValueKind == JsonValueKind.Array);
        Expect("with one entry per world", ok: doc.RootElement.GetArrayLength() == 2);

        var empty = WorldFolder.ToArrayJson(Array.Empty<string>());
        using var emptyDoc = JsonDocument.Parse(empty);
        Expect("an empty folder produces an empty array, not an empty string", ok: emptyDoc.RootElement.GetArrayLength() == 0);

        Expect("no worlds produces no trailing comma", ok: !empty.Contains(","));
    }

    /* ------------------------------ reporting ------------------------------- */

    private static void Expect(string name, bool ok)
    {
        if (!ok) _failed++;
        Console.WriteLine($"{(ok ? "PASS" : "FAIL")}  {name}");
    }
}