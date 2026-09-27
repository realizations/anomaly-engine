using System;

namespace AnomalyEngine.Core;

public enum PowerState { AC, Battery, Sleep, Resume, Hibernate }

public class PowerStateChangedEventArgs : EventArgs
{
    public PowerState State { get; set; }
}

public class PowerManager : IDisposable
{
    private readonly Logger _logger;
    private System.Threading.Timer? _timer;
    private PowerState _lastState;

    public event EventHandler<PowerStateChangedEventArgs>? PowerStateChanged;

    public PowerManager(Logger logger)
    {
        _logger = logger;
        _timer = new System.Threading.Timer(_ => CheckPowerState(), null, TimeSpan.Zero, TimeSpan.FromSeconds(30));
    }

    private void CheckPowerState()
    {
        var state = System.Windows.SystemParameters.PowerLineStatus == System.Windows.PowerLineStatus.Online
            ? PowerState.AC
            : PowerState.Battery;

        if (state != _lastState)
        {
            _lastState = state;
            _logger.Info($"Power state changed: {state}");
            PowerStateChanged?.Invoke(this, new PowerStateChangedEventArgs { State = state });
        }
    }

    public void Dispose()
    {
        _timer?.Dispose();
    }
}
