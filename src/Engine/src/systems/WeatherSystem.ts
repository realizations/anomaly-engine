import { simulateWeather, type SimulatedWeather } from './LocalWeather.js';

export type WeatherCondition = 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'fog';

export interface WeatherData {
  condition: WeatherCondition;
  temperature: number;
  humidity: number;
  windSpeed: number;
  windDirection: number;
  pressure: number;
  visibility: number;
  uvIndex: number;
  timestamp: number;
  /**
   * The synoptic regime, where the source has one.
   *
   * Optional because a network provider has no such concept -- it reports what is, not
   * which phase of a pressure system produced it. Present on local readings, and read
   * by the debug overlay and the settings status document.
   */
  regime?: 'high' | 'low' | 'front';
}

export interface WeatherProvider {
  name: string;
  fetchWeather(lat: number, lon: number): Promise<WeatherData>;
}

/**
 * Projects the local model onto the provider-shaped record.
 *
 * Two fields are not directly comparable and are mapped rather than copied:
 * `windSpeed` is metres per second in the real world and a 0..1 fraction in the
 * renderer's own units, and `humidity` is already 0..1 here. The copy is explicit
 * about which is which so nobody "fixes" the scale later.
 */
export function localToWeatherData(w: SimulatedWeather): WeatherData {
  return {
    condition: w.condition,
    temperature: w.temperature,
    humidity: w.humidity,
    windSpeed: w.windSpeed * 12,
    windDirection: w.windDirection,
    pressure: w.pressure,
    visibility: w.visibility,
    uvIndex: w.uvIndex,
    timestamp: w.timestamp,
    regime: w.regime,
  };
}

export class OpenWeatherMapProvider implements WeatherProvider {
  name = 'openweathermap';
  private _apiKey: string;

  constructor(apiKey: string) {
    this._apiKey = apiKey;
  }

  async fetchWeather(lat: number, lon: number): Promise<WeatherData> {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${this._apiKey}&units=metric`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Weather API error: ${response.status}`);
    const data = await response.json();

    return {
      condition: this._mapCondition(data.weather[0].main),
      temperature: data.main.temp,
      humidity: data.main.humidity,
      windSpeed: data.wind.speed,
      windDirection: data.wind.deg,
      pressure: data.main.pressure,
      visibility: data.visibility / 1000,
      uvIndex: 0,
      timestamp: Date.now(),
    };
  }

  private _mapCondition(main: string): WeatherCondition {
    switch (main.toLowerCase()) {
      case 'clear': return 'clear';
      case 'clouds': return 'cloudy';
      case 'rain': case 'drizzle': return 'rain';
      case 'thunderstorm': return 'storm';
      case 'snow': return 'snow';
      case 'mist': case 'fog': case 'haze': return 'fog';
      default: return 'cloudy';
    }
  }
}

export class WeatherSystem {
  private _provider: WeatherProvider | null = null;
  private _currentWeather: WeatherData | null = null;
  private _updateInterval: number;
  private _timer: number | null = null;
  private _listeners: ((weather: WeatherData) => void)[] = [];
  private _errorListeners: ((error: Error) => void)[] = [];
  private _location: { lat: number; lon: number } | null = null;

  constructor(updateIntervalSeconds = 600) {
    this._updateInterval = updateIntervalSeconds;
  }

  setProvider(provider: WeatherProvider): void {
    this._provider = provider;
    // A provider arriving after `start` has to be used immediately, or the engine sits
    // on the default weather until the next tick -- which is ten minutes of nothing.
    if (this._location) void this._fetchWeather(this._location.lat, this._location.lon);
  }

  getProvider(): WeatherProvider | null {
    return this._provider;
  }

  start(lat: number, lon: number): void {
    this._location = { lat, lon };
    void this._fetchWeather(lat, lon);
    this._timer = window.setInterval(
      () => void this._fetchWeather(lat, lon),
      this._updateInterval * 1000
    );
  }

  /** Where the model is being evaluated. Null before `start`. */
  getLocation(): { lat: number; lon: number } | null {
    return this._location;
  }

  stop(): void {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._location = null;
  }

  /**
   * Produces the weather, from a provider if there is one and the local model if not.
   *
   * This used to `return` when no provider was set, which is the whole reason the
   * desktop was permanently clear: the system was constructed and started every boot,
   * and did nothing at all, and nothing anywhere recorded that it was doing nothing.
   *
   * The local model is not a fallback in the usual sense -- it is the default, and it is
   * what the settings window, `docs/architecture.md` and `docs/how-to-use.md` have
   * always described. A provider, if one is ever configured, takes precedence.
   */
  private async _fetchWeather(lat: number, lon: number): Promise<void> {
    try {
      let data: WeatherData;
      if (this._provider) {
        data = await this._provider.fetchWeather(lat, lon);
      } else {
        data = localToWeatherData(simulateWeather({ lat, lon }, new Date()));
      }
      this._currentWeather = data;
      this._listeners.forEach((fn) => fn(data));
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      // A provider that fails does not leave the desktop without weather. The local
      // model is always available and cannot fail, so a fetch error degrades to it
      // rather than to a blank sky.
      if (this._provider) {
        this._currentWeather = localToWeatherData(simulateWeather({ lat, lon }, new Date()));
        this._currentWeather.temperature = Number.NaN;
        this._listeners.forEach((fn) => fn(this._currentWeather!));
      }
      this._errorListeners.forEach((fn) => fn(error));
    }
  }

  getCurrentWeather(): WeatherData | null {
    return this._currentWeather;
  }

  onUpdate(listener: (weather: WeatherData) => void): () => void {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
  }

  onError(listener: (error: Error) => void): () => void {
    this._errorListeners.push(listener);
    return () => {
      const idx = this._errorListeners.indexOf(listener);
      if (idx >= 0) this._errorListeners.splice(idx, 1);
    };
  }

  dispose(): void {
    this.stop();
    this._listeners = [];
    this._errorListeners = [];
  }
}
