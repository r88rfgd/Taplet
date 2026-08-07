// theme.js — Brutalist/minimalist theme + shared helpers
import { Dimensions } from 'react-native';
import { API_BASE_URL as ENV_API_BASE_URL } from '@env';

// Fallback so the app still runs if the .env is missing.
export const API_BASE_URL = ENV_API_BASE_URL || "http://100.109.7.33:8000";

export const { width } = Dimensions.get('window');

// ---------- Brutalist Theme (flat, hard edges, high contrast) ----------
export const THEMES = {
  light: {
    bg: '#ffffff',
    card: '#ffffff',
    text: '#000000',
    subText: '#444444',
    border: '#000000',
    accent: '#0033ff', // blue
    accentBg: '#0033ff',
    accentText: '#ffffff',
    green: '#007a00',
    yellow: '#9a7d00',
    orange: '#cc4400',
    red: '#cc0000',
    shadow: '#000000',
    mapDot: '#0033ff',
  },
  dark: {
    bg: '#0a0a0a',
    card: '#0a0a0a',
    text: '#ffffff',
    subText: '#9a9a9a',
    border: '#ffffff',
    accent: '#3b82f6', // blue
    accentBg: '#3b82f6',
    accentText: '#ffffff',
    green: '#22c55e',
    yellow: '#eab308',
    orange: '#f97316',
    red: '#ef4444',
    shadow: '#000000',
    mapDot: '#3b82f6',
  },
};

export const riskColor = (c, level = '') => {
  const l = String(level).toUpperCase();
  if (l.includes('LOW')) return c.green;
  if (l.includes('MODERATE')) return c.yellow;
  if (l.includes('HIGH')) return c.orange;
  return c.red;
};

export const riskColorFromScore = (c, score = 0) => {
  if (score < 33) return c.green;
  if (score < 66) return c.yellow;
  return c.orange;
};

export const daysUntil = (iso) => {
  if (!iso) return 9999;
  const d = new Date(iso).getTime();
  const now = Date.now();
  return Math.ceil((d - now) / (1000 * 60 * 60 * 24));
};

// Map weather_code (Open-Meteo WMO) → emoji + condition
export const weatherEmoji = (code, windSpeed) => {
  if (code === undefined || code === null) return '🌤️';
  if (windSpeed > 20) return '🍃';
  if ([0, 1].includes(code)) return '☀️';
  if ([2, 3].includes(code)) return '⛅';
  if ([45, 48].includes(code)) return '🌫️';
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return '🌧️';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return '🌨️';
  if ([95, 96, 99].includes(code)) return '⛈️';
  return '🌤️';
};

// Risk severity rank used to prioritize pins
export const RISK_RANK = { high: 0, medium: 1, low: 2, unknown: 3 };

// Convert a meteorological wind direction (degrees, 0=N, 90=E) to a compass label.
export const degToCompass = (deg) => {
  if (deg == null || isNaN(deg)) return '--';
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(((deg % 360) / 22.5)) % 16];
};

export const sortByRisk = (scans = []) =>
  [...scans].sort(
    (a, b) =>
      (RISK_RANK[String(a.risk_severity).toLowerCase()] ?? 9) -
      (RISK_RANK[String(b.risk_severity).toLowerCase()] ?? 9)
  );

export const MAX_PINS = 25;
