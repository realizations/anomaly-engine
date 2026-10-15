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
    /// Reads a single JSON object from a renderer answer, unwrapping first.
    ///
    /// The object counterpart of <see cref="TryReadCodeNamePairs"/>, for the calls that
    /// answer with one object -- the status document, a mapping test -- rather than a
    /// list. Returns false with a reason for anything else, and never throws, so a
    /// script error or a shape the renderer did not mean to send cannot reach a caller as
    /// an exception on the UI thread.
    ///
    /// This exists so the unwrap-and-check boundary is one function rather than a private
    /// helper on the window. The settings window calls it; `RendererReadTests` tests it;
    /// neither is the only place that knows how a payload is shaped.
    /// </summary>
    public static bool TryReadObject(string? json, out JsonElement element, out string reason)
    {
        element = default;
        reason = "";

        var text = Unwrap(json);
        if (string.IsNullOrWhiteSpace(text) || text == "null")
        {
            reason = "the renderer returned nothing";
            return false;
        }

        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(text);
        }
        catch (JsonException ex)
        {
            reason = $"the payload is not valid JSON: {ex.Message}";
            return false;
        }

        using (doc)
        {
            if (doc.RootElement.ValueKind != JsonValueKind.Object)
            {
                // A String here is a script error, and it is worth naming in the reason
                // because it is the only place the actual cause appears.
                reason =
                    $"the renderer returned {doc.RootElement.ValueKind} where an object was " +
                    $"expected. Payload: {Truncate(text)}";
                return false;
            }

            // A script error does not always arrive as a String: WebView2 returns the
            // failure text as a JSON-encoded value, and when that value is an object it
            // parses cleanly as one. Without this, a caller reading `fps` out of a page
            // that threw would get zero and a working-looking panel rather than "the
            // engine did not answer". `name`, `message` and `stack` together are the
            // error shape and not something a real status document carries.
            if (LooksLikeScriptError(doc.RootElement))
            {
                reason = $"the renderer answered with an error object. Payload: {Truncate(text)}";
                return false;
            }

            // Cloned, so the element outlives the document it was parsed from.
            element = doc.RootElement.Clone();
        }

        return true;
    }

    /// <summary>
    /// Whether an object is the shape WebView2 returns when the evaluated script throws.
    /// </summary>
    private static bool LooksLikeScriptError(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object) return false;
        if (!element.TryGetProperty("message", out var message) ||
            message.ValueKind != JsonValueKind.String)
        {
            return false;
        }
        // A stack trace is conclusive. Without one, the JavaScript error constructor
        // names are, and none of them is a field a status, mapping-test or preview
        // document carries.
        if (element.TryGetProperty("stack", out _)) return true;
        var name = element.TryGetProperty("name", out var n) && n.ValueKind == JsonValueKind.String
            ? n.GetString()
            : null;
        return name is "Error" or "TypeError" or "ReferenceError" or "SyntaxError"
            or "RangeError" or "URIError" or "EvalError";
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