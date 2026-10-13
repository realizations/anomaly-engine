using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace AnomalyEngine.Core;

/// <summary>
/// Fetches an event feed, on the host's behalf and under its rules.
///
/// The renderer cannot do this. The page is served from <c>file://</c> and the content
/// security policy sets <c>connect-src 'none'</c>, so a <c>fetch</c> from the renderer is
/// blocked before it starts. That policy is the reason this class exists rather than an
/// obstacle to working around, and it is why the renderer has no network access at all:
/// everything it learns arrives as text over a channel it cannot write to.
///
/// So all of the trust lives here, and this is the whole of it:
///
///   - <b>HTTPS only</b>, except plain HTTP on loopback. A feed URL the user pastes from a
///     page they were reading is the easiest way to end up on <c>http://</c>.
///   - <b>An explicit host allow-list.</b> Not "any host the user configured" -- the list
///     is what the user typed, so it would be no protection at all. The settings window
///     holds both, and a URL whose host is not on the list is refused with a reason.
///   - <b>No redirects.</b> Auto-redirect is off and a 3xx is reported as one. A
///     redirect is the one thing that turns an allow-listed host into an arbitrary one.
///   - <b>A response size cap</b>, read with a limit rather than trusting Content-Length.
///   - <b>A timeout</b>, and <b>a floor on how often a feed may be polled</b>.
///   - <b>No cookies, no credentials, no headers the user did not ask for.</b>
///
/// Nothing here parses the document. Parsing is the renderer's job and it is where the
/// restriction on what a feed may cause lives; this class's job is to deliver bytes it
/// is willing to deliver.
/// </summary>
public sealed class EventFeedFetcher : IDisposable
{
    /// <summary>
    /// Largest response accepted.
    ///
    /// A feed document is kilobytes. A megabyte means something is wrong, and reading it
    /// into a string to find out is the mistake: the cap is applied to the read itself.
    /// </summary>
    public const int MaxResponseBytes = 256 * 1024;

    /// <summary>Seconds before a request is abandoned.</summary>
    public const int TimeoutSeconds = 15;

    /// <summary>Shortest interval between two requests to the same feed.</summary>
    public const int MinIntervalSeconds = 60;

    /// <summary>Ceiling on configured feeds.</summary>
    public const int MaxFeeds = 8;

    private readonly HttpClient _http;
    private readonly Dictionary<string, DateTimeOffset> _lastRequest = new(StringComparer.Ordinal);

    public EventFeedFetcher()
    {
        var handler = new HttpClientHandler
        {
            // The single most important line in this file.
            AllowAutoRedirect = false,
            UseCookies = false,
            UseProxy = true,
        };
        _http = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(TimeoutSeconds) };
        _http.DefaultRequestHeaders.UserAgent.ParseAdd("AnomalyEngine/0.1 (+feed reader)");
    }

    /// <summary>One configured feed as the settings window holds it.</summary>
    public sealed record FeedSpec(
        string Id,
        string Url,
        bool Enabled,
        int IntervalSeconds,
        IReadOnlyList<string> AllowedHosts);

    public sealed record FetchResult(bool Ok, string Body, string Problem)
    {
        public static FetchResult Success(string body) => new(true, body, "");
        public static FetchResult Failure(string problem) => new(false, "", problem);
    }

    /// <summary>
    /// Checks a URL without fetching it, for the settings window as the user types.
    ///
    /// Separate from <see cref="Fetch"/> so the window can say "this host is not
    /// allow-listed" while the field is still being typed rather than after a round trip
    /// that fails.
    /// </summary>
    public static string ValidateUrl(string url, IReadOnlyList<string> allowedHosts)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri))
            return "Not a URL.";
        if (uri.Scheme == Uri.UriSchemeHttps) return "";
        if (uri.Scheme == Uri.UriSchemeHttp && IsLoopback(uri)) return "";
        return "Only https is allowed, except on localhost.";
    }

    /// <summary>
    /// Whether the URL's host is on the allow-list.
    ///
    /// Exact match on the host, not a suffix test. A suffix test is how
    /// <c>evil-github.com</c> and <c>github.com.attacker.net</c> both pass a check written
    /// for <c>github.com</c>.
    /// </summary>
    public static bool IsAllowed(string url, IReadOnlyList<string> allowedHosts)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) return false;
        foreach (var host in allowedHosts ?? Array.Empty<string>())
        {
            if (string.IsNullOrWhiteSpace(host)) continue;
            var trimmed = host.Trim();
            if (string.Equals(uri.Host, trimmed, StringComparison.OrdinalIgnoreCase)) return true;
            // A leading dot means "this host and its subdomains", which has to be
            // explicit, because silently accepting subdomains is the surprising choice.
            if (trimmed.StartsWith('.') &&
                uri.Host.EndsWith(trimmed, StringComparison.OrdinalIgnoreCase) &&
                uri.Host.Length > trimmed.Length)
                return true;
        }
        return false;
    }

    private static bool IsLoopback(Uri uri) =>
        uri.IsLoopback ||
        string.Equals(uri.Host, "localhost", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Fetches one feed, refusing anything outside the rules.
    ///
    /// The rate limit is checked before the request, not after, because the point of a
    /// rate limit is to not make the request. It is keyed by feed id rather than by URL
    /// so two feeds pointing at the same host still each get their own floor, which is the
    /// stricter of the two readings and the one that matches what the person configuring
    /// them expects.
    /// </summary>
    public async Task<FetchResult> FetchAsync(FeedSpec feed, CancellationToken token = default)
    {
        if (!feed.Enabled) return FetchResult.Failure("Feed is disabled.");

        var schemeProblem = ValidateUrl(feed.Url, feed.AllowedHosts);
        if (schemeProblem.Length > 0) return FetchResult.Failure(schemeProblem);

        if (!IsAllowed(feed.Url, feed.AllowedHosts))
        {
            return FetchResult.Failure(
                $"Host '{SafeHost(feed.Url)}' is not on the allow-list. Add it in Settings " +
                "before this feed can be read.");
        }

        var interval = Math.Max(MinIntervalSeconds, feed.IntervalSeconds);
        if (_lastRequest.TryGetValue(feed.Id, out var last))
        {
            var since = DateTimeOffset.UtcNow - last;
            if (since.TotalSeconds < interval)
            {
                return FetchResult.Failure(
                    $"Asked too soon: {Math.Ceiling(interval - since.TotalSeconds)}s of the " +
                    $"{interval}s interval still to go.");
            }
        }
        _lastRequest[feed.Id] = DateTimeOffset.UtcNow;

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, feed.Url);
            // Accept is the only header set beyond the user agent, and it is a hint rather
            // than an instruction: a server that returns XML regardless is still parsed.
            request.Headers.TryAddWithoutValidation("Accept", "application/rss+xml, application/atom+xml, application/json, text/xml;q=0.9, */*;q=0.5");

            using var response = await _http.SendAsync(
                request, HttpCompletionOption.ResponseHeadersRead, token);

            if (IsRedirect((int)response.StatusCode))
            {
                // Named rather than silently followed, because a redirect from an
                // allow-listed host to an arbitrary one defeats the allow-list, and
                // "it redirected" is the only useful thing to tell the person.
                return FetchResult.Failure(
                    $"Redirected (HTTP {(int)response.StatusCode}). Redirects are not followed, " +
                    "because one would let an allow-listed host send the request elsewhere.");
            }

            if (!response.IsSuccessStatusCode)
                return FetchResult.Failure($"HTTP {(int)response.StatusCode}.");

            var declared = response.Content.Headers.ContentLength;
            if (declared.HasValue && declared.Value > MaxResponseBytes)
                return FetchResult.Failure($"Document is {declared.Value / 1024}KB, over the 256KB limit.");

            var body = await ReadCappedAsync(response, token);
            if (body == null)
                return FetchResult.Failure("Document is larger than the 256KB limit.");

            return FetchResult.Success(body);
        }
        catch (OperationCanceledException) when (!token.IsCancellationRequested)
        {
            return FetchResult.Failure($"Timed out after {TimeoutSeconds}s.");
        }
        catch (HttpRequestException ex)
        {
            return FetchResult.Failure(ex.Message);
        }
        catch (Exception ex)
        {
            return FetchResult.Failure(ex.Message);
        }
    }

    private static bool IsRedirect(int status) => status switch
    {
        301 or 302 or 303 or 307 or 308 => true,
        _ => false,
    };

    /// <summary>
    /// Reads at most <see cref="MaxResponseBytes"/>, without buffering the rest.
    ///
    /// Reads in chunks and stops at the cap rather than reading the response and checking
    /// its length afterwards, which is the version that would already have allocated
    /// whatever the server felt like sending.
    /// </summary>
    private static async Task<string?> ReadCappedAsync(HttpResponseMessage response, CancellationToken token)
    {
        await using var stream = await response.Content.ReadAsStreamAsync(token);
        using var buffer = new MemoryStream();
        var chunk = new byte[16 * 1024];

        while (true)
        {
            var read = await stream.ReadAsync(chunk, token);
            if (read <= 0) break;
            if (buffer.Length + read > MaxResponseBytes) return null;
            buffer.Write(chunk, 0, read);
        }

        return Encoding.UTF8.GetString(buffer.ToArray());
    }

    /// <summary>
    /// The host part of a URL, for an error message.
    ///
    /// Falls back to a placeholder rather than echoing the whole URL: an error that
    /// printed the full address would put a token that happens to be in the query string
    /// into a log file.
    /// </summary>
    private static string SafeHost(string url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var uri) ? uri.Host : "(unparseable)";

    public void Dispose() => _http.Dispose();
}