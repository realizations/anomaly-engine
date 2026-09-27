using System;
using System.IO;
using System.Text.Json;

namespace AnomalyEngine.Core;

public enum LogLevel { Trace, Debug, Info, Warn, Error, Fatal }

public class Logger : IDisposable
{
    private readonly string _logDirectory;
    private readonly string _logFile;
    private readonly object _lock = new();
    private StreamWriter? _writer;

    public LogLevel MinimumLevel { get; set; } = LogLevel.Info;

    public Logger()
    {
        _logDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "AnomalyEngine", "logs");
        Directory.CreateDirectory(_logDirectory);
        _logFile = Path.Combine(_logDirectory, $"engine-{DateTime.Now:yyyy-MM-dd}.log");
        _writer = new StreamWriter(_logFile, append: true) { AutoFlush = true };
    }

    public void Log(LogLevel level, string message, Exception? ex = null)
    {
        if (level < MinimumLevel) return;

        var entry = new
        {
            Timestamp = DateTime.Now.ToString("O"),
            Level = level.ToString().ToUpperInvariant(),
            Message = message,
            Exception = ex?.ToString()
        };

        var json = JsonSerializer.Serialize(entry);
        lock (_lock)
        {
            _writer?.WriteLine(json);
        }
    }

    public void Trace(string message) => Log(LogLevel.Trace, message);
    public void Debug(string message) => Log(LogLevel.Debug, message);
    public void Info(string message) => Log(LogLevel.Info, message);
    public void Warn(string message) => Log(LogLevel.Warn, message);
    public void Error(string message, Exception? ex = null) => Log(LogLevel.Error, message, ex);
    public void Fatal(string message, Exception? ex = null) => Log(LogLevel.Fatal, message, ex);

    public void Dispose()
    {
        _writer?.Dispose();
        _writer = null;
    }
}
