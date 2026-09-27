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
}

export interface WeatherProvider {
  name: string;
  fetchWeather(lat: number, lon: number): Promise<WeatherData>;
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

  constructor(updateIntervalSeconds = 600) {
    this._updateInterval = updateIntervalSeconds;
  }

  setProvider(provider: WeatherProvider): void {
    this._provider = provider;
  }

  start(lat: number, lon: number): void {
    this._fetchWeather(lat, lon);
    this._timer = window.setInterval(() => this._fetchWeather(lat, lon), this._updateInterval * 1000);
  }

  stop(): void {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  private async _fetchWeather(lat: number, lon: number): Promise<void> {
    if (!this._provider) return;
    try {
      const weather = await this._provider.fetchWeather(lat, lon);
      this._currentWeather = weather;
      this._listeners.forEach(fn => fn(weather));
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this._errorListeners.forEach(fn => fn(error));
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
