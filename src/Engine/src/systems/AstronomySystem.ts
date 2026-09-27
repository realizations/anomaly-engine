export interface AstronomyData {
  sunAltitude: number;
  sunAzimuth: number;
  moonAltitude: number;
  moonAzimuth: number;
  moonPhase: number;
  moonIllumination: number;
  sunrise: Date | null;
  sunset: Date | null;
  moonrise: Date | null;
  moonset: Date | null;
  isNight: boolean;
  isDawn: boolean;
  isDusk: boolean;
  timestamp: number;
}

export class AstronomySystem {
  private _latitude: number;
  private _longitude: number;
  private _currentData: AstronomyData | null = null;
  private _timer: number | null = null;
  private _listeners: ((data: AstronomyData) => void)[] = [];

  constructor(latitude: number, longitude: number) {
    this._latitude = latitude;
    this._longitude = longitude;
  }

  start(): void {
    this._update();
    this._timer = window.setInterval(() => this._update(), 60000);
  }

  stop(): void {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  private _update(): void {
    const now = new Date();
    this._currentData = this._compute(now);
    this._listeners.forEach(fn => fn(this._currentData!));
  }

  private _compute(date: Date): AstronomyData {
    const sunPos = this._computeSunPosition(date);
    const moonPos = this._computeMoonPosition(date);
    const moonPhase = this._computeMoonPhase(date);
    const sunrise = this._computeSunrise(date);
    const sunset = this._computeSunset(date);

    return {
      sunAltitude: sunPos.altitude,
      sunAzimuth: sunPos.azimuth,
      moonAltitude: moonPos.altitude,
      moonAzimuth: moonPos.azimuth,
      moonPhase,
      moonIllumination: Math.abs(Math.cos(moonPhase * Math.PI * 2)),
      sunrise,
      sunset,
      moonrise: null,
      moonset: null,
      isNight: sunPos.altitude < -6,
      isDawn: sunPos.altitude >= -6 && sunPos.altitude < 0,
      isDusk: sunPos.altitude >= 0 && sunPos.altitude < 6,
      timestamp: date.getTime(),
    };
  }

  private _computeSunPosition(date: Date): { altitude: number; azimuth: number } {
    const lat = this._latitude * Math.PI / 180;
    const lon = this._longitude;

    const dayOfYear = this._getDayOfYear(date);
    const hour = date.getUTCHours() + date.getUTCMinutes() / 60 + lon / 15;

    const declination = 23.45 * Math.sin((360 / 365) * (dayOfYear - 81) * Math.PI / 180) * Math.PI / 180;
    const hourAngle = (hour - 12) * 15 * Math.PI / 180;

    const altitude = Math.asin(
      Math.sin(lat) * Math.sin(declination) +
      Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle)
    ) * 180 / Math.PI;

    const azimuth = Math.atan2(
      Math.sin(hourAngle),
      Math.cos(hourAngle) * Math.sin(lat) - Math.tan(declination) * Math.cos(lat)
    ) * 180 / Math.PI + 180;

    return { altitude, azimuth };
  }

  private _computeMoonPosition(date: Date): { altitude: number; azimuth: number } {
    const sunPos = this._computeSunPosition(date);
    const moonOffset = 180;
    return {
      altitude: -sunPos.altitude * 0.8,
      azimuth: (sunPos.azimuth + moonOffset) % 360,
    };
  }

  private _computeMoonPhase(date: Date): number {
    const synodicMonth = 29.53058867;
    const knownNewMoon = Date.UTC(2000, 0, 6, 18, 14) / 86400000;
    const daysSince = date.getTime() / 86400000 - knownNewMoon;
    return (daysSince % synodicMonth) / synodicMonth;
  }

  private _computeSunrise(date: Date): Date | null {
    const lat = this._latitude * Math.PI / 180;
    const dayOfYear = this._getDayOfYear(date);
    const declination = 23.45 * Math.sin((360 / 365) * (dayOfYear - 81) * Math.PI / 180) * Math.PI / 180;
    const hourAngle = Math.acos(-Math.tan(lat) * Math.tan(declination)) * 180 / Math.PI;
    const sunriseHour = 12 - hourAngle / 15 - this._longitude / 15;
    const result = new Date(date);
    result.setUTCHours(Math.floor(sunriseHour), Math.floor((sunriseHour % 1) * 60), 0, 0);
    return result;
  }

  private _computeSunset(date: Date): Date | null {
    const lat = this._latitude * Math.PI / 180;
    const dayOfYear = this._getDayOfYear(date);
    const declination = 23.45 * Math.sin((360 / 365) * (dayOfYear - 81) * Math.PI / 180) * Math.PI / 180;
    const hourAngle = Math.acos(-Math.tan(lat) * Math.tan(declination)) * 180 / Math.PI;
    const sunsetHour = 12 + hourAngle / 15 - this._longitude / 15;
    const result = new Date(date);
    result.setUTCHours(Math.floor(sunsetHour), Math.floor((sunsetHour % 1) * 60), 0, 0);
    return result;
  }

  private _getDayOfYear(date: Date): number {
    const start = new Date(date.getFullYear(), 0, 0);
    const diff = date.getTime() - start.getTime();
    return Math.floor(diff / 86400000);
  }

  getCurrentData(): AstronomyData | null {
    return this._currentData;
  }

  onUpdate(listener: (data: AstronomyData) => void): () => void {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
  }

  dispose(): void {
    this.stop();
    this._listeners = [];
  }
}
