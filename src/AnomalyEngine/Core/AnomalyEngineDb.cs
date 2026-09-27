using System;
using System.Data;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace AnomalyEngine.Core;

public class AnomalyEngineDb : IDisposable
{
    private readonly string _dbPath;
    private IntPtr _connection = IntPtr.Zero;

    [DllImport("sqlite3", CallingConvention = CallingConvention.Cdecl)]
    private static extern int sqlite3_open(string filename, out IntPtr db);

    [DllImport("sqlite3", CallingConvention = CallingConvention.Cdecl)]
    private static extern int sqlite3_close(IntPtr db);

    [DllImport("sqlite3", CallingConvention = CallingConvention.Cdecl)]
    private static extern int sqlite3_exec(IntPtr db, string sql, IntPtr callback, IntPtr arg, out IntPtr errMsg);

    [DllImport("sqlite3", CallingConvention = CallingConvention.Cdecl)]
    private static extern int sqlite3_prepare_v2(IntPtr db, string sql, int length, out IntPtr stmt, out IntPtr tail);

    [DllImport("sqlite3", CallingConvention = CallingConvention.Cdecl)]
    private static extern int sqlite3_step(IntPtr stmt);

    [DllImport("sqlite3", CallingConvention = CallingConvention.Cdecl)]
    private static extern int sqlite3_finalize(IntPtr stmt);

    [DllImport("sqlite3", CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr sqlite3_column_text(IntPtr stmt, int col);

    [DllImport("sqlite3", CallingConvention = CallingConvention.Cdecl)]
    private static extern int sqlite3_column_int64(IntPtr stmt, int col);

    [DllImport("sqlite3", CallingConvention = CallingConvention.Cdecl)]
    private static extern int sqlite3_bind_text(IntPtr stmt, int index, string value, int length, IntPtr destructor);

    [DllImport("sqlite3", CallingConvention = CallingConvention.Cdecl)]
    private static extern int sqlite3_bind_int64(IntPtr stmt, int index, long value);

    public AnomalyEngineDb()
    {
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var dbDir = Path.Combine(appData, "AnomalyEngine");
        Directory.CreateDirectory(dbDir);
        _dbPath = Path.Combine(dbDir, "anomaly-engine.db");
        Open();
        CreateTables();
    }

    private void Open()
    {
        var result = sqlite3_open(_dbPath, out _connection);
        if (result != 0) throw new Exception($"Failed to open database: {result}");
    }

    private void CreateTables()
    {
        var sql = @"
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS secrets (
                id TEXT PRIMARY KEY,
                discovered_at INTEGER NOT NULL,
                state TEXT NOT NULL,
                notes TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS event_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                source TEXT NOT NULL,
                payload TEXT,
                timestamp INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS journal (
                id TEXT PRIMARY KEY,
                anomaly_id TEXT NOT NULL,
                anomaly_name TEXT NOT NULL,
                rarity TEXT NOT NULL,
                location TEXT NOT NULL,
                notes TEXT DEFAULT '',
                screenshot TEXT,
                state TEXT NOT NULL DEFAULT 'observed',
                clues TEXT DEFAULT '[]',
                timestamp INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS cooldowns (
                event_type TEXT PRIMARY KEY,
                last_fired INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS moments (
                id TEXT PRIMARY KEY,
                discovered_at INTEGER NOT NULL,
                screenshot TEXT,
                notes TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS worlds (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                version TEXT NOT NULL,
                installed_at INTEGER NOT NULL,
                last_activated INTEGER,
                config TEXT DEFAULT '{}'
            );
        ";

        var result = sqlite3_exec(_connection, sql, IntPtr.Zero, IntPtr.Zero, out var errMsg);
        if (result != 0) throw new Exception($"Failed to create tables: {result}");
    }

    public string? GetSetting(string key)
    {
        var sql = "SELECT value FROM settings WHERE key = ?";
        var result = sqlite3_prepare_v2(_connection, sql, -1, out var stmt, out _);
        if (result != 0) return null;

        sqlite3_bind_text(stmt, 1, key, -1, IntPtr.Zero);
        result = sqlite3_step(stmt);

        string? value = null;
        if (result == 100)
        {
            var ptr = sqlite3_column_text(stmt, 0);
            value = Marshal.PtrToStringAnsi(ptr);
        }

        sqlite3_finalize(stmt);
        return value;
    }

    public void SetSetting(string key, string value)
    {
        var sql = @"
            INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        ";
        var result = sqlite3_prepare_v2(_connection, sql, -1, out var stmt, out _);
        if (result != 0) return;

        sqlite3_bind_text(stmt, 1, key, -1, IntPtr.Zero);
        sqlite3_bind_text(stmt, 2, value, -1, IntPtr.Zero);
        sqlite3_bind_int64(stmt, 3, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        sqlite3_step(stmt);
        sqlite3_finalize(stmt);
    }

    public void UnlockSecret(string id, string notes)
    {
        var sql = "INSERT OR IGNORE INTO secrets (id, discovered_at, state, notes) VALUES (?, ?, 'discovered', ?)";
        var result = sqlite3_prepare_v2(_connection, sql, -1, out var stmt, out _);
        if (result != 0) return;

        sqlite3_bind_text(stmt, 1, id, -1, IntPtr.Zero);
        sqlite3_bind_int64(stmt, 2, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        sqlite3_bind_text(stmt, 3, notes, -1, IntPtr.Zero);
        sqlite3_step(stmt);
        sqlite3_finalize(stmt);
    }

    public void AddJournalEntry(string id, string anomalyId, string anomalyName, string rarity, string location, string notes, string screenshot, string state, string clues)
    {
        var sql = @"
            INSERT INTO journal (id, anomaly_id, anomaly_name, rarity, location, notes, screenshot, state, clues, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ";
        var result = sqlite3_prepare_v2(_connection, sql, -1, out var stmt, out _);
        if (result != 0) return;

        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        sqlite3_bind_text(stmt, 1, id, -1, IntPtr.Zero);
        sqlite3_bind_text(stmt, 2, anomalyId, -1, IntPtr.Zero);
        sqlite3_bind_text(stmt, 3, anomalyName, -1, IntPtr.Zero);
        sqlite3_bind_text(stmt, 4, rarity, -1, IntPtr.Zero);
        sqlite3_bind_text(stmt, 5, location, -1, IntPtr.Zero);
        sqlite3_bind_text(stmt, 6, notes, -1, IntPtr.Zero);
        sqlite3_bind_text(stmt, 7, screenshot, -1, IntPtr.Zero);
        sqlite3_bind_text(stmt, 8, state, -1, IntPtr.Zero);
        sqlite3_bind_text(stmt, 9, clues, -1, IntPtr.Zero);
        sqlite3_bind_int64(stmt, 10, now);
        sqlite3_step(stmt);
        sqlite3_finalize(stmt);
    }

    public void Dispose()
    {
        if (_connection != IntPtr.Zero)
        {
            sqlite3_close(_connection);
            _connection = IntPtr.Zero;
        }
    }
}
