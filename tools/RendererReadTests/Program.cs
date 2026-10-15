using AnomalyEngine.Core;

namespace RendererReadTests;

/// <summary>
/// Proves a failed renderer read cannot reach the settings window as a crash.
///
/// This exists because it did. `ExecuteScriptAsync` does not throw when the evaluated
/// script fails: it returns the failure as a JSON string, which parses cleanly and then
/// throws "requires an element of type 'Array', but the target element has type 'String'"
/// at the first `EnumerateArray`. That exception reached the window's load path
/// unhandled, was rethrown on the dispatcher, and ended the process.
///
/// The payloads below are the shapes WebView2 actually returns, which is what makes this
/// a regression test rather than a description of the bug.
/// </summary>
public static class RendererReadTests
{
    private static int _failed;

    /// <summary>What WebView2 hands back when the evaluated script throws.</summary>
    private const string ScriptError =
        "{\"name\":\"TypeError\",\"message\":\"window.__engine.getAvailableLocales is not a function\"," +
        "\"stack\":\"at <anonymous>:1:1\"}";

    /// <summary>The same thing, already encoded as a JSON string literal.</summary>
    private const string QuotedError = "\"{\\\"name\\\":\\\"TypeError\\\",\\\"message\\\":\\\"boom\\\"}\"";

    public static int Run()
    {
        // The old code's exact failure, so the regression is visible in the log.
        //
        // `QuotedError`, not `ScriptError`: WebView2 returns the failure already encoded
        // as a JSON string, so `JsonDocument.Parse` yields a String root and the message
        // reads "has type 'String'". That is the text in the crash log from the real
        // failure, and a test reproducing "has type 'Object'" would be reproducing a
        // slightly different bug.
        var reproduced = ThrowsOnEnumerate(QuotedError);
        Expect(
            "the old failure is reproduced by enumerating the error string",
            reproduced != null && reproduced.Contains("has type 'String'", StringComparison.Ordinal),
            reproduced ?? "(did not throw, so this no longer reproduces)");

        // The reader, against every shape that can come back.
        Expect("a script error yields no locales and no throw", !Read(ScriptError, out var a) && a.Count == 0);
        Expect("and says why, naming the cause", !Read(ScriptError, out _, out var why) && why.Contains("String"), why);
        Expect("a quoted script error is handled the same way", !Read(QuotedError, out var q) && q.Count == 0);
        Expect("null is handled", !Read("null", out var n) && n.Count == 0);
        Expect("an empty string is handled", !Read("", out var e0) && e0.Count == 0);
        Expect("whitespace is handled", !Read("   ", out var w) && w.Count == 0);
        Expect("unparseable JSON is handled", !Read("{not json", out var g) && g.Count == 0);
        Expect("an object where an array was expected is handled", !Read("{}", out var o) && o.Count == 0);
        Expect("a number is handled", !Read("42", out var num) && num.Count == 0);

        // And the case that has to keep working, because a reader that refuses everything
        // would be a fix that quietly disables the feature.
        var good = Read("[{\"code\":\"en\",\"name\":\"English\"},{\"code\":\"de\",\"name\":\"Deutsch\"}]", out var list);
        Expect("a real list is still read", good && list.Count == 2);
        Expect("the entries are in order and intact", good && list[0] == ("en", "English") && list[1] == ("de", "Deutsch"));

        // The shape that actually arrives, and the whole reason for `Unwrap`.
        //
        // `ExecuteScriptAsync` returns the JSON-serialised value of the script's last
        // expression. Every call of the form `JSON.stringify(x)` therefore comes back
        // twice encoded: the array was stringified into a string, and that string was
        // then serialised as a JSON string. This is the payload that made the settings
        // window throw on every open, and it is the case a test written from the
        // JavaScript side gets wrong -- `page.evaluate` hands back the raw array, so a
        // probe in a browser shows a perfectly good result and proves nothing about the
        // host's transport.
        const string doubleEncoded = "\"[{\\\"code\\\":\\\"en\\\",\\\"name\\\":\\\"English\\\"}," +
                                     "{\\\"code\\\":\\\"de\\\",\\\"name\\\":\\\"Deutsch\\\"}]\"";
        Expect("the real double-encoded payload parses as JSON", CanParse(doubleEncoded));
        Expect("and its root is a String, which is the bug",
            RootKind(doubleEncoded) == System.Text.Json.JsonValueKind.String);

        var unwrapped = Read(doubleEncoded, out var transported);
        Expect("a double-encoded list is read after unwrapping", unwrapped && transported.Count == 2);
        Expect("with the right entries", unwrapped && transported[1] == ("de", "Deutsch"));
        Expect("unwrapping is idempotent",
            RendererRead.Unwrap(RendererRead.Unwrap(doubleEncoded)) == RendererRead.Unwrap(doubleEncoded));

        // Unwrapping must not mangle a payload that is already the right shape.
        Expect("an already-unwrapped payload is left alone",
            RendererRead.Unwrap("[{\"code\":\"en\"}]") == "[{\"code\":\"en\"}]");
        Expect("non-JSON is handed back unchanged", RendererRead.Unwrap("{not json") == "{not json");
        Expect("null is handed back unchanged", RendererRead.Unwrap("null") == "null");
        Expect("the string \"null\" unwraps to null and is treated as no answer",
            !Read("\"null\"", out var nullStr) && nullStr.Count == 0);
        Expect("an empty list is an empty read, not a failure", Read("[]", out var empty) && empty.Count == 0);
        Expect("entries missing a name are skipped, not fatal",
            Read("[{\"code\":\"en\"},{\"code\":\"de\",\"name\":\"Deutsch\"}]", out var partial) && partial.Count == 1);
        Expect("non-object entries are skipped, not fatal",
            Read("[1,\"two\",{\"code\":\"en\",\"name\":\"English\"}]", out var mixed) && mixed.Count == 1);

        // The log line is truncated, because a renderer error carries a stack trace and an
        // error message long enough to scroll a terminal away is not a log line.
        Read("\"" + new string('x', 5000) + "\"", out _, out var truncated);
        Expect("a huge payload is truncated in the reason", truncated.Length < 500, $"len {truncated.Length}");

        // The settings window's other reads return *objects* rather than lists, and it is
        // now `Unwrap` that normalises them -- the fleet of `JsonNode.Parse(json)?.ToString()`
        // call sites is gone. Those only produced the right string because a JsonNode
        // holding a string prints it unquoted, which is a coincidence rather than a
        // contract. These lock in that the explicit boundary handles the object payloads
        // the same double-encoded way, so the change cannot have swapped one accident for
        // another.
        Expect("an already-plain object is left alone",
            RendererRead.Unwrap("{\"fps\":60}") == "{\"fps\":60}");

        const string doubleEncodedObject = "\"{\\\"fps\\\":60,\\\"style\\\":\\\"painterly\\\"}\"";
        var unwrappedObject = RendererRead.Unwrap(doubleEncodedObject);
        Expect("a double-encoded object unwraps to the object text",
            unwrappedObject == "{\"fps\":60,\"style\":\"painterly\"}");
        Expect("and that text deserialises, which is what the window actually needs",
            DeserialisesToFps(unwrappedObject, 60));

        // TryReadObject: the object-shaped reads (status, a mapping test, a document
        // preview) share one boundary now instead of a private helper per caller.
        Expect("an object is read", ReadObject("{\"a\":1}", out _));
        Expect("a double-encoded object is read", ReadObject(doubleEncodedObject, out _));
        Expect("an array where an object was expected is refused",
            !ReadObject("[1,2]", out var whyArray) && whyArray.Contains("Array"));
        // A script error is the interesting case: it arrives as an object, so a reader
        // that only checks the root kind would accept it and report defaults. It is
        // refused by its shape, and the reason names it.
        Expect("an object-shaped script error is refused and named",
            !ReadObject(ScriptError, out var whyScript) && whyScript.Contains("error"));
        Expect("a quoted script error is refused too", !ReadObject(QuotedError, out _));
        Expect("null is refused", !ReadObject("null", out _));
        Expect("the string \"null\" is refused", !ReadObject("\"null\"", out _));
        Expect("empty is refused", !ReadObject("", out _));
        Expect("a number is refused", !ReadObject("42", out _));
        Expect("malformed JSON is refused", !ReadObject("{not json", out _));

        return _failed;
    }

    private static bool Read(string? json, out List<(string, string)> items, out string reason) =>
        RendererRead.TryReadCodeNamePairs(json, out items, out reason);

    private static bool Read(string? json, out List<(string, string)> items) =>
        Read(json, out items, out _);

    private static bool ReadObject(string? json, out string reason) =>
        RendererRead.TryReadObject(json, out _, out reason);

    private static bool DeserialisesToFps(string? json, int expected)
    {
        if (string.IsNullOrWhiteSpace(json)) return false;
        try
        {
            // The real payload mixes types, so read it the way the window does: a
            // dictionary of JsonElement with each field narrowed on demand.
            var map = System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, System.Text.Json.JsonElement>>(json);
            return map is not null && map.TryGetValue("fps", out var fps)
                && fps.TryGetInt32(out var n) && n == expected;
        }
        catch
        {
            return false;
        }
    }

    private static bool CanParse(string json)
    {
        try { using var _ = System.Text.Json.JsonDocument.Parse(json); return true; }
        catch { return false; }
    }

    private static System.Text.Json.JsonValueKind? RootKind(string json)
    {
        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(json);
            return doc.RootElement.ValueKind;
        }
        catch
        {
            return null;
        }
    }

    private static string? ThrowsOnEnumerate(string json)
    {
        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(json);
            foreach (var _ in doc.RootElement.EnumerateArray()) { }
            return null;
        }
        catch (Exception ex)
        {
            return ex.Message;
        }
    }

    private static void Expect(string name, bool ok, string? detail = null)
    {
        if (!ok) _failed++;
        Console.WriteLine($"{(ok ? "PASS" : "FAIL")}  {name}{(detail is null ? "" : $"  -- {detail}")}");
    }
}

public static class Program
{
    public static int Main()
    {
        var failed = RendererReadTests.Run();
        Console.WriteLine(failed == 0
            ? "\nA renderer read failure cannot crash anything."
            : $"\n{failed} check(s) failed.");
        return failed == 0 ? 0 : 1;
    }
}