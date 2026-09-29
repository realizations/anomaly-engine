using System;
using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;

namespace AnomalyEngine.Core;

/// <summary>
/// Durable engine state, stored as a JSON document in %APPDATA%\AnomalyEngine.
///
/// The engine runs inside WebView2, where native SQLite bindings do not load
/// reliably, so the host owns the write. The document is small (selected world,
/// style, journal, discovered secrets), so a file is the right store and a
/// database would be overhead.
/// </summary>
public sealed class StateStore : IDisposable
{
    private readonly Logger _logger;
    private readonly string _path;
    private readonly object _lock = new();
    private JsonObject? _state;
    private Timer? _flushTimer;

    public StateStore(Logger logger)
    {
        _logger = logger;
        var dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "AnomalyEngine");
        Directory.CreateDirectory(dir);
        _path = Path.Combine(dir, "state.json");
    }

    public string StateJson
    {
        get
        {
            lock (_lock)
            {
                if (_state is null) Load();
                return _state?.ToJsonString() ?? "{}";
            }
        }
    }

    public void Load()
    {
        lock (_lock)
        {
            if (_state is not null) return;
            try
            {
                if (File.Exists(_path))
                {
                    var text = File.ReadAllText(_path);
                    _state = JsonNode.Parse(text) as JsonObject ?? new JsonObject();
                    _logger.Info("Loaded saved state.");
                }
                else
                {
                    _state = new JsonObject();
                    _logger.Info("No saved state, starting fresh.");
                }
            }
            catch (Exception ex)
            {
                // A corrupt state file must not stop the engine from starting.
                _logger.Warn($"Saved state unreadable, starting fresh: {ex.Message}");
                _state = new JsonObject();
            }
        }
    }

    public void Save(JsonObject? patch)
    {
        lock (_lock)
        {
            // Load() guarantees _state is non-null, but the compiler cannot see
            // that through the call, and a null here would silently drop a save.
            if (_state is null) Load();
            var state = _state;
            if (state is null)
            {
                _logger.Warn("State unavailable; skipping save rather than throwing.");
                return;
            }
            if (patch is not null)
            {
                foreach (var kv in patch)
                {
                    // A null value is a deliberate instruction to clear the key,
                    // not a value to clone.
                    state[kv.Key] = kv.Value?.DeepClone();
                }
            }
        }
        // Coalesce bursts: the engine saves on meaningful changes, not per frame.
        _flushTimer?.Dispose();
        _flushTimer = new Timer(_ => Flush(), null, 1200, Timeout.Infinite);
    }

    private void Flush()
    {
        try
        {
            string json;
            lock (_lock)
            {
                if (_state is null) return;
                _state["lastSeen"] = DateTime.UtcNow.ToString("O");
                json = _state.ToJsonString();
            }
            File.WriteAllText(_path, json);
        }
        catch (Exception ex)
        {
            _logger.Warn($"Failed to write state: {ex.Message}");
        }
    }

    public void Dispose()
    {
        _flushTimer?.Dispose();
        _flushTimer = null;
        Flush();
    }
}
