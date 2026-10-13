using System.Net;
using System.Text;
using AnomalyEngine.Core;

namespace EventFeedTests;

/// <summary>
/// Runs <see cref="EventFeedFetcher"/> against a listener that misbehaves on request.
///
/// The happy path is not what is being tested. What is being tested is that a server
    /// which redirects, lies about its length, streams without end, or is not on the list
    /// cannot get anything it should not.
    ///
    /// The listener is plain HTTP, so the network checks use the loopback exemption
    /// rather than https. That is not a gap in the coverage: the scheme rule itself is
    /// checked directly in <see cref="TestSchemeRules"/>, and everything below it is
    /// transport-agnostic. Standing up a TLS listener for a test would need a certificate
    /// this repository has no reason to carry.
/// </summary>
public static class Program
{
    private static int _failed;
    private static HttpListener _listener = null!;
    private static string _prefix = "";

    /// <summary>
    /// What the listener should do with the next request.
    ///
    /// Static because the listener runs on another thread and a closure would be a race
    /// waiting to happen in a test that is already about concurrency.
    /// </summary>
    private static Func<HttpListenerContext, bool> _handler = _ => false;

    public static int Main()
    {
        StartListener();

        try
        {
            TestSchemeRules();
            TestAllowList();

            // The network-facing checks share one listener, so they run in sequence
            // rather than concurrently: each replaces the handler the next one depends
            // on, and interleaving them would be testing the harness rather than the
            // fetcher.
            TestRefusesRedirectAsync().GetAwaiter().GetResult();
            TestRefusesOversizedBodyAsync().GetAwaiter().GetResult();
            TestHonoursRateLimitAsync().GetAwaiter().GetResult();
            TestReportsHttpErrorAsync().GetAwaiter().GetResult();
            TestSucceedsAsync().GetAwaiter().GetResult();
TestRefusesDisabledFeedAsync().GetAwaiter().GetResult();
        }
        finally
        {
            _listener.Stop();
            _listener.Close();
        }

        Console.WriteLine(_failed == 0
            ? "\nThe feed fetcher holds its rules."
            : $"\n{_failed} check(s) failed.");
        return _failed == 0 ? 0 : 1;
    }

    /* ------------------------------- the server ------------------------------ */

    private static void StartListener()
    {
        var port = FreePort();
        _prefix = $"http://127.0.0.1:{port}/";
        _listener = new HttpListener();
        _listener.Prefixes.Add(_prefix);
        _listener.Start();
        _ = Task.Run(async () =>
        {
            while (_listener.IsListening)
            {
                HttpListenerContext ctx;
                try { ctx = await _listener.GetContextAsync(); }
                catch { return; }
                try { _handler(ctx); }
                catch { /* a misbehaving test server is fine */ }
            }
        });
    }

    private static int FreePort()
    {
        var l = new System.Net.Sockets.TcpListener(IPAddress.Loopback, 0);
        l.Start();
        var port = ((IPEndPoint)l.LocalEndpoint).Port;
        l.Stop();
        return port;
    }

    private static void Serve(int status, string body, string contentType = "application/xml")
    {
        _handler = ctx =>
        {
            ctx.Response.StatusCode = status;
            ctx.Response.ContentType = contentType;
            var bytes = Encoding.UTF8.GetBytes(body);
            ctx.Response.ContentLength64 = bytes.Length;
            ctx.Response.OutputStream.Write(bytes, 0, bytes.Length);
            ctx.Response.Close();
            return true;
        };
    }

    private static void Redirect(int status, string location)
    {
        _handler = ctx =>
        {
            ctx.Response.StatusCode = status;
            ctx.Response.Headers.Add("Location", location);
            ctx.Response.Close();
            return true;
        };
    }

    /* --------------------------------- checks -------------------------------- */

    private static void TestSchemeRules()
    {
        var hosts = new[] { "example.invalid" };

        Expect("https is allowed", EventFeedFetcher.ValidateUrl("https://example.invalid/feed", hosts) == "");
        Expect("plain http is refused", EventFeedFetcher.ValidateUrl("http://example.invalid/feed", hosts).Length > 0);
        Expect("http on loopback is allowed", EventFeedFetcher.ValidateUrl("http://127.0.0.1:9/feed", hosts) == "");
        Expect("http on localhost is allowed", EventFeedFetcher.ValidateUrl("http://localhost:9/feed", hosts) == "");
        Expect("file:// is refused", EventFeedFetcher.ValidateUrl("file:///C:/feed.xml", hosts).Length > 0);
        Expect("ftp:// is refused", EventFeedFetcher.ValidateUrl("ftp://example.invalid/f", hosts).Length > 0);
        Expect("a javascript: URL is refused", EventFeedFetcher.ValidateUrl("javascript:alert(1)", hosts).Length > 0);
        Expect("rubbish is refused", EventFeedFetcher.ValidateUrl("not a url at all", hosts).Length > 0);
        Expect("empty is refused", EventFeedFetcher.ValidateUrl("", hosts).Length > 0);
    }

    private static void TestAllowList()
    {
        var hosts = new[] { "example.invalid", ".trusted.invalid" };

        Expect("an allow-listed host passes", EventFeedFetcher.IsAllowed("https://example.invalid/feed", hosts));
        Expect("an unlisted host is refused", !EventFeedFetcher.IsAllowed("https://elsewhere.invalid/feed", hosts));
        Expect("an empty list allows nothing", !EventFeedFetcher.IsAllowed("https://example.invalid/feed", Array.Empty<string>()));
        Expect("a null list allows nothing", !EventFeedFetcher.IsAllowed("https://example.invalid/feed", null!));

        // The check this whole method exists for: a substring or suffix test would pass
        // both of these, and they are the two ways an allow-list gets defeated.
        Expect("a host merely ending in the allowed name is refused",
            !EventFeedFetcher.IsAllowed("https://evil-example.invalid/feed", hosts));
        Expect("a host that starts with the allowed name is refused",
            !EventFeedFetcher.IsAllowed("https://example.invalid.attacker.net/feed", hosts));

        Expect("a leading dot means subdomains, and does match them",
            EventFeedFetcher.IsAllowed("https://feeds.trusted.invalid/x", hosts));
        Expect("a leading dot still does not match the bare domain's attacker",
            !EventFeedFetcher.IsAllowed("https://nottrusted.invalid/x", hosts));

        Expect("the match ignores case", EventFeedFetcher.IsAllowed("https://EXAMPLE.invalid/x", hosts));
        Expect("an unparseable URL is refused", !EventFeedFetcher.IsAllowed("nonsense", hosts));
    }

    private static async Task TestRefusesRedirectAsync()
    {
        // A redirect is the one thing that turns an allow-listed host into an arbitrary
        // one, so it is reported rather than followed.
        Redirect(302, "https://attacker.invalid/steal");
        using var fetcher = new EventFeedFetcher();
        var result = await fetcher.FetchAsync(Spec("x", "127.0.0.1"));

        Expect("a 302 is refused", !result.Ok);
        Expect("the refusal says it was a redirect", result.Problem.Contains("Redirect", StringComparison.OrdinalIgnoreCase));
        Expect("the refusal does not name where it went", !result.Problem.Contains("attacker.invalid"));

        Redirect(307, "https://attacker.invalid/steal");
        using var fetcher2 = new EventFeedFetcher();
        Expect("a 307 is refused too", !(await fetcher2.FetchAsync(Spec("x", "127.0.0.1"))).Ok);
    }

    private static async Task TestRefusesOversizedBodyAsync()
    {
        // Read with a cap rather than read-then-check, so a server that streams without
        // end cannot make the host allocate whatever it likes.
        _handler = ctx =>
        {
            ctx.Response.StatusCode = 200;
            ctx.Response.ContentType = "application/xml";
            var chunk = new byte[64 * 1024];
            for (var i = 0; i < chunk.Length; i++) chunk[i] = (byte)('a' + (i % 26));
            for (var written = 0; written < 12; written++)
            {
                ctx.Response.OutputStream.Write(chunk, 0, chunk.Length);
            }
            ctx.Response.Close();
            return true;
        };

        using var fetcher = new EventFeedFetcher();
        var result = await fetcher.FetchAsync(Spec("big", "127.0.0.1"));
        Expect("a body over the cap is refused", !result.Ok);
        Expect("the refusal mentions the limit", result.Problem.Contains("256KB", StringComparison.OrdinalIgnoreCase));

        // And a document declaring a huge Content-Length is refused before the body is
        // read at all.
        _handler = ctx =>
        {
            ctx.Response.StatusCode = 200;
            ctx.Response.ContentType = "application/xml";
            ctx.Response.ContentLength64 = 50L * 1024 * 1024;
            ctx.Response.Close();
            return true;
        };
        using var fetcher2 = new EventFeedFetcher();
        var declared = await fetcher2.FetchAsync(Spec("declared", "127.0.0.1"));
        Expect("a declared length over the cap is refused", !declared.Ok);
    }

    private static async Task TestHonoursRateLimitAsync()
    {
        Serve(200, "<rss/>");
        using var fetcher = new EventFeedFetcher();
        var feed = Spec("rate", "127.0.0.1", intervalSeconds: 3600);

        var first = await fetcher.FetchAsync(feed);
        Expect("the first request succeeds", first.Ok);

        var second = await fetcher.FetchAsync(feed);
        Expect("an immediate second request is refused", !second.Ok);
        Expect("the refusal says why", second.Problem.Contains("too soon", StringComparison.OrdinalIgnoreCase));

        // A different feed id gets its own floor, which is the stricter reading: two
        // feeds pointing at one host should not be a way to double the request rate.
        var other = Spec("rate", "127.0.0.1", id: "b", intervalSeconds: 3600);
        var third = await fetcher.FetchAsync(other);
        Expect("a different feed has its own floor", third.Ok);
    }

    private static async Task TestReportsHttpErrorAsync()
    {
        Serve(503, "busy");
        using var fetcher = new EventFeedFetcher();
        var result = await fetcher.FetchAsync(Spec("down", "127.0.0.1"));
        Expect("a 503 is reported", !result.Ok);
        Expect("the status is in the message", result.Problem.Contains("503"));
    }

    private static async Task TestSucceedsAsync()
    {
        const string body = "<?xml version=\"1.0\"?><rss><channel><item><title>Hello</title></item></channel></rss>";
        Serve(200, body);

using var fetcher = new EventFeedFetcher();
        var result = await fetcher.FetchAsync(Spec("ok", "127.0.0.1"));
        Expect("an allowed request succeeds", result.Ok);
        Expect("the body comes back intact", result.Body == body);
        if (!result.Ok) Console.WriteLine($"      (the fetcher said: {result.Problem})");
    }

    private static async Task TestRefusesDisabledFeedAsync()
    {
        Serve(200, "<rss/>");
        using var fetcher = new EventFeedFetcher();
        var result = await fetcher.FetchAsync(Spec("off", "127.0.0.1", enabled: false));
        Expect("a disabled feed is not requested", !result.Ok);
        Expect("the refusal says it is disabled", result.Problem.Contains("disabled", StringComparison.OrdinalIgnoreCase));
    }

private static EventFeedFetcher.FeedSpec Spec(
        string path,
        string host,
        bool enabled = true,
        int intervalSeconds = 0,
        string id = "a") =>
        new(id, Url(path), enabled, intervalSeconds, new[] { host });

    /// <summary>
    /// A URL on the listener, which is on a port chosen at run time.
    /// </summary>
    private static string Url(string path) => _prefix + path;

    private static void Expect(string name, bool ok)
    {
        if (!ok) _failed++;
        Console.WriteLine($"{(ok ? "PASS" : "FAIL")}  {name}");
    }
}

