using System;
using System.Collections.Generic;
using System.Text.Json.Nodes;

namespace AnomalyEngine.Core;

/// <summary>
/// The edits the settings window makes to a feed list, as pure functions over the same
/// JSON the engine round-trips.
/// </summary>
/// <remarks>
/// This lives in Core rather than in the window's code-behind for one reason: the window
/// is a WPF <c>Window</c>, so anything written inside it can only be exercised by
/// rendering the window. The operations below are the ones a mistake would be silent in
/// -- a rule added with no effect, a duplicate that fires twice, a removal that takes the
/// wrong one -- and they are exactly the operations worth a test that runs without a
/// desktop. So they are here, and the window calls them.
///
/// Nothing here validates a URL or an effect against a *document*. The effect ids come in
/// from the registry the window read from the renderer, and the match is only ever used
/// as a substring of a headline. A rule this accepts can select one of the registered
/// effects and nothing else, which is the same boundary `FeedMapper` enforces on the
/// renderer side.
/// </remarks>
public static class FeedRules
{
    /// <summary>Finds a feed by its id, or null.</summary>
    public static JsonObject? Find(JsonArray? feeds, string feedId)
    {
        if (feeds is null || feedId.Length == 0) return null;
        foreach (var node in feeds)
        {
            if (node is JsonObject o && o["id"]?.GetValue<string>() == feedId) return o;
        }
        return null;
    }

    /// <summary>
    /// The usable rules on one feed, as (match, anomaly) pairs in order.
    ///
    /// A malformed entry is skipped rather than repaired: a rule missing its effect is not
    /// a rule, and showing one would suggest the feed can cause something it cannot.
    /// </summary>
    public static IReadOnlyList<(string Match, string Anomaly)> RulesOf(JsonObject? feed)
    {
        var list = new List<(string, string)>();
        if (feed?["rules"] is not JsonArray rules) return list;
        foreach (var node in rules)
        {
            if (node is not JsonObject r) continue;
            var match = r["match"]?.GetValue<string>() ?? "";
            var anomaly = r["anomaly"]?.GetValue<string>() ?? "";
            if (match.Length == 0 || anomaly.Length == 0) continue;
            list.Add((match, anomaly));
        }
        return list;
    }

    /// <summary>
    /// Adds a rule to a feed. Returns false with a plain-language reason when it is
    /// refused, so the window can say what the user has to change rather than failing
    /// silently.
    ///
    /// Refused when the match is blank, when the effect is not one of
    /// <paramref name="knownEffects"/>, or when an identical rule is already present.
    /// The duplicate check ignores case because the match itself does: two rules that
    /// differ only in case are the same rule, and adding both would be a way to make one
    /// headline fire twice.
    /// </summary>
    public static bool TryAddRule(
        JsonObject? feed,
        string match,
        string anomaly,
        IReadOnlyList<string> knownEffects,
        out string problem)
    {
        problem = "";
        if (feed is null)
        {
            problem = "That feed is no longer in the list.";
            return false;
        }

        match = (match ?? "").Trim();
        if (match.Length == 0)
        {
            problem = "Type the words to match in a headline first.";
            return false;
        }
        if (!Contains(knownEffects, anomaly))
        {
            problem = "Choose one of the registered effects.";
            return false;
        }

        foreach (var (existingMatch, existingAnomaly) in RulesOf(feed))
        {
            if (existingAnomaly == anomaly &&
                string.Equals(existingMatch, match, StringComparison.OrdinalIgnoreCase))
            {
                problem = "That rule is already on this feed.";
                return false;
            }
        }

        if (feed["rules"] is not JsonArray rules)
        {
            rules = new JsonArray();
            feed["rules"] = rules;
        }
        rules.Add(new JsonObject { ["match"] = match, ["anomaly"] = anomaly });
        return true;
    }

    /// <summary>Removes the rule at <paramref name="index"/>. False when out of range.</summary>
    public static bool RemoveRule(JsonObject? feed, int index)
    {
        if (feed?["rules"] is not JsonArray rules) return false;
        if (index < 0 || index >= rules.Count) return false;
        rules.RemoveAt(index);
        return true;
    }

    /// <summary>Sets a feed's enabled flag. False when the feed is not in the list.</summary>
    public static bool SetEnabled(JsonArray? feeds, string feedId, bool enabled)
    {
        var feed = Find(feeds, feedId);
        if (feed is null) return false;
        feed["enabled"] = enabled;
        return true;
    }

    /// <summary>
    /// One rule as a line of text: the words to match, and the effect they select.
    ///
    /// The effect is named from the registry the window read. An id the registry does not
    /// contain is shown as the id itself rather than blank, because that is what a rule
    /// left over from a newer build looks like from the user's side, and a blank arrow is
    /// worse than a strange word.
    /// </summary>
    public static string Describe(
        string match,
        string anomaly,
        IReadOnlyList<(string Id, string Name)> effects)
    {
        foreach (var (id, name) in effects)
        {
            if (id == anomaly) return $"\"{match}\"  \u2192  {name}";
        }
        return $"\"{match}\"  \u2192  {anomaly}";
    }

    private static bool Contains(IReadOnlyList<string> values, string value)
    {
        // A loop rather than `Enumerable.Contains` so this file needs no LINQ, the same
        // reason the rest of Core avoids it: it runs on the UI thread.
        for (var i = 0; i < values.Count; i++)
        {
            if (values[i] == value) return true;
        }
        return false;
    }
}
