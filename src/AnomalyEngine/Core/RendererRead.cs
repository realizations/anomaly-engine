using System;
using System.Collections.Generic;
using System.Text.Json;

namespace AnomalyEngine.Core;

/// <summary>
/// Reads results the renderer sent back, without assuming they are what was asked for.
///
/// The reason this class exists is one specific behaviour of WebView2.
/// <c>ExecuteScriptAsync</c> does not throw when the evaluated script fails. It returns
/// the failure as a JSON *string*, which parses without complaint and then throws
/// "requires an element of type 'Array', but the target element has type 'String'" at the
/// first <c>EnumerateArray</c>.
///
/// That exception reached the settings window's load path unhandled, was rethrown on the
/// dispatcher, and took the whole application down when somebody opened the settings
/// window. The renderer had not answered yet -- a timing problem -- and a timing problem
/// in a read helper became a crash in the product.
///
/// So: check the kind before enumerating, return a reason instead of throwing, and let
/// the caller decide. Every read from the renderer goes through here, because the
/// failure mode is a property of the transport rather than of any one call.
/// </summary>
public static class RendererRead
{
    /// <summary>
/// Unwraps the JSON string encoding that WebView2 puts around every result.
///
/// `ExecuteScriptAsync` returns the JSON-serialised value of the script's last
/// expression. Every call of the form <c>JSON.stringify(x)</c> therefore comes back
/// *twice* encoded: the array was stringified into a string, and that string was then
/// serialised as a JSON string. The payload looks like
/// <c>"[{\"code\":\"en\",...}]"</c> rather than <c>[{"code":"en",...}]</c>.
///
/// This is the single most confusing thing about reading from the renderer, and it bit
/// the settings window: parsing such a payload with <c>JsonDocument</c> yields a String,
/// not an Array, and enumerating it throws.
///
/// Note that most of the codebase got this right by accident rather than by design.
/// Eight of the ten call sites use <c>JsonNode.Parse(json)?.ToString()</c>, and a
/// <c>JsonNode</c> holding a string prints that string *unquoted*, so the extra layer
/// is removed by a coincidence of <c>ToString</c>. The two that used
/// <c>JsonDocument.Parse</c> were the ones that broke, and one of them crashed the
/// application. Every read goes through here now rather than through two different
/// idioms that happen to disagree.
/// </summary>
    public static string? Unwrap(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return json;

        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind == JsonValueKind.String)
            {
                return doc.RootElement.GetString();
            }
        }
        catch (JsonException)
        {
            // Not JSON at all. Handed back unchanged so the caller's own error message
            // is the useful one, rather than this function's.
        }
        return json;
    }

    /// <summary>
    /// Reads a JSON array of <c>{ code, name }</c> objects.
    ///
    /// Returns false with a reason for anything else -- an error string, a truncated
    /// document, an object where an array was expected, or nothing at all. Never throws.
    /// </summary>
    public static bool TryReadCodeNamePairs(
        string? json,
        out List<(string Code, string Name)> items,
        out string reason)
    {
        items = new List<(string, string)>();
        reason = "";

        json = Unwrap(json);

        // Checked after unwrapping as well as before: a script that returns the *string*
        // "null" is still "did not answer", not an error.
        if (string.IsNullOrWhiteSpace(json))
        {
            reason = "the renderer returned nothing";
            return false;
        }
        if (json == "null")
        {
            reason = "the renderer returned null";
            return false;
        }

        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(json);
        }
        catch (JsonException ex)
        {
            reason = $"the payload is not valid JSON: {ex.Message}";
            return false;
        }

        using (doc)
        {
            if (doc.RootElement.ValueKind != JsonValueKind.Array)
            {
                // The interesting one. A String here means the script threw, and the
                // payload is the error itself -- which is worth logging, truncated,
                // because it is the only place the actual cause appears.
                reason =
                    $"the renderer returned {doc.RootElement.ValueKind} where an array was " +
                    $"expected. A String here is a script error, which WebView2 hands back as " +
                    $"a JSON string. Payload: {Truncate(json)}";
                return false;
            }

            foreach (var item in doc.RootElement.EnumerateArray())
            {
                if (item.ValueKind != JsonValueKind.Object) continue;
                if (item.TryGetProperty("code", out var c) && item.TryGetProperty("name", out var n))
                {
                    items.Add((c.GetString() ?? "", n.GetString() ?? ""));
                }
            }
        }

        return true;
    }

    /// <summary>
    /// Truncates a payload for a log line.
    ///
    /// A renderer error carries a stack trace, and an error message long enough to scroll
    /// a terminal off the end is not a log line.
    /// </summary>
    public static string Truncate(string text, int max = 300) =>
        text.Length <= max ? text : text[..max] + "...";
}