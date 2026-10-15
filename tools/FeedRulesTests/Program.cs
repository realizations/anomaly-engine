using System.Text.Json.Nodes;
using AnomalyEngine.Core;

namespace FeedRulesTests;

/// <summary>
/// Checks the pure feed-rule edits the settings window performs.
///
/// The failures these guard against are all quiet ones: a rule added with an effect the
/// renderer cannot draw, a duplicate rule that makes one headline fire twice, a removal
/// that takes a different rule than the one clicked, or an enable toggle that lands on
/// the wrong feed. None of them would crash anything, which is exactly why they need a
/// test rather than an eyeball.
/// </summary>
public static class Program
{
    private static int _failed;

    private static readonly List<string> Effects = new()
    {
        "second-moon", "red-moon", "meteor",
        "observatory-signal", "forest-watcher", "lights-out",
    };

    private static readonly List<(string Id, string Name)> Registry = new()
    {
        ("second-moon", "Second Moon"),
        ("red-moon", "Red Moon"),
        ("meteor", "Meteor"),
        ("observatory-signal", "Observatory Signal"),
        ("forest-watcher", "Watcher in the Pines"),
        ("lights-out", "Lights Out"),
    };

    public static int Main()
    {
        FindTests();
        RulesOfTests();
        AddRuleTests();
        RemoveRuleTests();
        SetEnabledTests();
        DescribeTests();

        Console.WriteLine(_failed == 0
            ? "\nFeed rules are edited the way they are meant to be."
            : $"\n{_failed} check(s) failed.");
        return _failed == 0 ? 0 : 1;
    }

    private static void FindTests()
    {
        var feeds = Feeds(("a", false), ("b", true));
        Expect("a feed is found by its id", FeedRules.Find(feeds, "a")?["id"]?.GetValue<string>() == "a");
        Expect("an unknown id is not found", FeedRules.Find(feeds, "zzz") is null);
        Expect("a null list finds nothing", FeedRules.Find(null, "a") is null);
        Expect("an empty id finds nothing", FeedRules.Find(feeds, "") is null);
    }

    private static void RulesOfTests()
    {
        var feed = new JsonObject { ["id"] = "a", ["rules"] = new JsonArray() };
        Expect("a feed with no rules has none", FeedRules.RulesOf(feed).Count == 0);

        feed["rules"] = new JsonArray(
            new JsonObject { ["match"] = "maintenance", ["anomaly"] = "meteor" },
            new JsonObject { ["match"] = "", ["anomaly"] = "red-moon" },
            new JsonObject { ["match"] = "lights", ["anomaly"] = "" },
            new JsonObject { ["match"] = "ok", ["anomaly"] = "second-moon" });
        var rules = FeedRules.RulesOf(feed);
        Expect("only complete rules are read", rules.Count == 2);
        Expect("and they keep their order and values",
            rules[0] == ("maintenance", "meteor") && rules[1] == ("ok", "second-moon"));
        Expect("a feed with no rules array has none", FeedRules.RulesOf(new JsonObject()).Count == 0);
        Expect("a null feed has none", FeedRules.RulesOf(null).Count == 0);
    }

    private static void AddRuleTests()
    {
        var feed = new JsonObject { ["id"] = "a", ["rules"] = new JsonArray() };

        Expect("a valid rule is added", FeedRules.TryAddRule(feed, "maintenance", "meteor", Effects, out _));
        Expect("and it is on the feed", FeedRules.RulesOf(feed).Count == 1);

        Expect("the match is trimmed",
            FeedRules.TryAddRule(feed, "  release  ", "lights-out", Effects, out _)
            && FeedRules.RulesOf(feed)[1] == ("release", "lights-out"));

        Expect("a blank match is refused",
            !FeedRules.TryAddRule(feed, "   ", "meteor", Effects, out var blank) && blank.Length > 0);
        Expect("an unknown effect is refused",
            !FeedRules.TryAddRule(feed, "anything", "not-an-effect", Effects, out var unknown) && unknown.Length > 0);
        Expect("a duplicate rule is refused",
            !FeedRules.TryAddRule(feed, "maintenance", "meteor", Effects, out var dup) && dup.Length > 0);
        Expect("a duplicate that differs only in case is refused too",
            !FeedRules.TryAddRule(feed, "MAINTENANCE", "meteor", Effects, out _));
        Expect("but the same words selecting a different effect is allowed",
            FeedRules.TryAddRule(feed, "maintenance", "red-moon", Effects, out _));
        Expect("a null feed is refused",
            !FeedRules.TryAddRule(null, "x", "meteor", Effects, out _));

        // A feed read back with no rules array at all is the shape a hand-edited state
        // file or an older build produces.
        var bare = new JsonObject { ["id"] = "b" };
        Expect("a feed with no rules array gains one",
            FeedRules.TryAddRule(bare, "snow", "meteor", Effects, out _) && FeedRules.RulesOf(bare).Count == 1);
    }

    private static void RemoveRuleTests()
    {
        var feed = new JsonObject
        {
            ["id"] = "a",
            ["rules"] = new JsonArray(
                new JsonObject { ["match"] = "one", ["anomaly"] = "meteor" },
                new JsonObject { ["match"] = "two", ["anomaly"] = "red-moon" },
                new JsonObject { ["match"] = "three", ["anomaly"] = "lights-out" }),
        };

        Expect("the right rule is removed", FeedRules.RemoveRule(feed, 1));
        var left = FeedRules.RulesOf(feed);
        Expect("and the others are untouched",
            left.Count == 2 && left[0].Match == "one" && left[1].Match == "three");

        Expect("an out-of-range removal is refused", !FeedRules.RemoveRule(feed, 9));
        Expect("a negative index is refused", !FeedRules.RemoveRule(feed, -1));
        Expect("a null feed is refused", !FeedRules.RemoveRule(null, 0));
    }

    private static void SetEnabledTests()
    {
        var feeds = Feeds(("a", false), ("b", true));

        Expect("a feed can be turned on", FeedRules.SetEnabled(feeds, "a", true));
        Expect("and the flag moved", FeedRules.Find(feeds, "a")?["enabled"]?.GetValue<bool>() == true);
        Expect("a feed can be turned off", FeedRules.SetEnabled(feeds, "b", false)
            && FeedRules.Find(feeds, "b")?["enabled"]?.GetValue<bool>() == false);
        Expect("and the other feed is not touched",
            FeedRules.Find(feeds, "a")?["enabled"]?.GetValue<bool>() == true);
        Expect("an unknown feed is refused", !FeedRules.SetEnabled(feeds, "zzz", true));
        Expect("a null list is refused", !FeedRules.SetEnabled(null, "a", true));
    }

    private static void DescribeTests()
    {
        Expect("a registered effect is named",
            FeedRules.Describe("lights", "lights-out", Registry) == "\"lights\"  \u2192  Lights Out");
        Expect("an id with no name is shown as itself",
            FeedRules.Describe("lights", "from-the-future", Registry) == "\"lights\"  \u2192  from-the-future");
    }

    /* --------------------------------- helpers -------------------------------- */

    private static JsonArray Feeds(params (string Id, bool Enabled)[] specs)
    {
        var feeds = new JsonArray();
        foreach (var (id, enabled) in specs)
        {
            feeds.Add(new JsonObject { ["id"] = id, ["url"] = $"https://{id}.invalid/feed", ["enabled"] = enabled });
        }
        return feeds;
    }

    private static void Expect(string name, bool ok)
    {
        if (!ok) _failed++;
        Console.WriteLine($"{(ok ? "PASS" : "FAIL")}  {name}");
    }
}
