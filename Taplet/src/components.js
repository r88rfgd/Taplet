// components.js — Reusable brutalist components
import React, { useRef, useEffect, useState } from 'react';
import { View, Text, Animated, TouchableOpacity } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { riskColor, riskColorFromScore, weatherEmoji, sortByRisk, MAX_PINS, degToCompass } from './theme';
import { makeStyles } from './styles';

// ---------- Risk Ring (SVG) ----------
export function RiskRing({ c, score = 0, level = 'HIGH', size = 132 }) {
  // The gemma overall_risk_score is 0-10 normally, but when the model returns a
  // value on a different scale (e.g. 0-100) we must scale the ring to that max
  // so we never show a nonsensical "35/10". Derive the max from the score.
  const max = (score != null && score > 10) ? 100 : 10;
  const frac = Math.max(0, Math.min(1, (score || 0) / max));
  const stroke = 12;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const dash = circumference * frac;
  const color = riskColor(c, level);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={cx} cy={cy} r={r} stroke={c.border} strokeWidth={stroke} fill="none" />
        <Circle
          cx={cx}
          cy={cy}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="butt"
          strokeDasharray={`${dash} ${circumference}`}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      </Svg>
      <Text style={[{ fontSize: 30, fontWeight: '900', color: c.text }]}>
        {score != null ? score : '--'}
        <Text style={[{ fontSize: 14, color: c.subText }]}>/{max}</Text>
      </Text>
      <Text style={[{ fontSize: 11, fontWeight: '900', letterSpacing: 1, marginTop: 2, color }]}>
        {String(level).toUpperCase()}
      </Text>
    </View>
  );
}

// ---------- Risk Bar (animated) ----------
export function RiskBar({ c, label, score, max = 100, delay = 0 }) {
  const w = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(w, { toValue: Math.max(6, (score / max) * 100), duration: 700, delay, useNativeDriver: false }).start();
  }, [score]);
  const color = riskColorFromScore(c, score);
  const s = makeStyles(c);
  return (
    <View style={s.barRow}>
      <Text style={s.barLabel}>{label}</Text>
      <View style={s.barTrack}>
        <Animated.View style={[s.barFill, { width: w.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }), backgroundColor: color }]} />
      </View>
    </View>
  );
}

// ---------- Weather Card (emoji right, info left) ----------
export function WeatherCard({ c, meteo }) {
  const s = makeStyles(c);
  const code = meteo?.weather_code;
  const wind = meteo?.wind_speed_kmh ?? 0;
  const windDir = meteo?.wind_direction_deg;
  const windLabel = windDir != null ? degToCompass(windDir) : '--';
  const emoji = weatherEmoji(code, wind);

  return (
    <View style={s.weatherRow}>
      <View style={s.weatherInfo}>
        <Text style={s.weatherTemp}>{meteo?.temperature_c ?? '--'}°C</Text>
        <Text style={s.weatherSub}>
          💧 {meteo?.humidity_pct ?? '--'}%  ·  🍃 {wind} km/h {windLabel} ({windDir ?? '--'}°)
        </Text>
      </View>
      <View style={s.weatherEmojiBox}>
        <Text style={{ fontSize: 56 }}>{emoji}</Text>
      </View>
    </View>
  );
}

// ---------- Date Picker Calendar (no native dependency) ----------
function pad(n) { return String(n).padStart(2, '0'); }
function toISO(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function sameDay(a, b) {
  return a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// A minimal month-grid calendar. `value` is an ISO string (YYYY-MM-DD) or ''.
// `onChange(isoString)` returns the chosen date as ISO. Closes via `onClose`.
export function DatePickerCalendar({ c, value, onChange, onClose }) {
  const s = makeStyles(c);
  const initial = value ? new Date(value + 'T00:00:00') : new Date();
  const [view, setView] = useState(startOfMonth(initial));
  const [sel, setSel] = useState(value ? new Date(value + 'T00:00:00') : null);

  const year = view.getFullYear();
  const month = view.getMonth();
  const firstWeekday = view.getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));

  const WEEK = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  const move = (delta) => setView(new Date(year, month + delta, 1));
  const pick = (d) => { if (!d) return; setSel(d); onChange(toISO(d)); onClose && onClose(); };

  return (
    <View style={[s.card, { borderColor: c.accent, borderWidth: 2 }]}>
      <View style={s.heroRow}>
        <TouchableOpacity onPress={() => move(-1)}><Text style={{ color: c.accent, fontWeight: '900', fontSize: 18 }}>‹</Text></TouchableOpacity>
        <Text style={[s.sectionTitle, { color: c.text }]}>
          {view.toLocaleString('default', { month: 'short' })} {year}
        </Text>
        <TouchableOpacity onPress={() => move(1)}><Text style={{ color: c.accent, fontWeight: '900', fontSize: 18 }}>›</Text></TouchableOpacity>
      </View>
      <View style={{ flexDirection: 'row', marginTop: 6 }}>
        {WEEK.map((w, i) => (
          <Text key={i} style={[s.barLabel, { flex: 1, textAlign: 'center' }]}>{w}</Text>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {cells.map((d, i) => {
          if (!d) return <View key={i} style={{ width: '14.28%', aspectRatio: 1 }} />;
          const isSel = sameDay(d, sel);
          const isToday = sameDay(d, new Date());
          return (
            <TouchableOpacity
              key={i}
              onPress={() => pick(d)}
              style={{
                width: '14.28%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center',
                borderWidth: isSel ? 2 : (isToday ? 1 : 0),
                borderColor: isSel ? c.accent : c.subText,
                backgroundColor: isSel ? c.accent : 'transparent',
              }}
            >
              <Text style={{ fontWeight: '900', color: isSel ? c.accentText : c.text }}>{d.getDate()}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <TouchableOpacity style={[s.btn, s.btnPrimary, { marginTop: 10 }]} onPress={() => onClose && onClose()}>
        <Text style={s.btnText}>{sel ? 'DONE' : 'CANCEL'}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ---------- Scan Map (blue dot + max 25 pins by risk) ----------
export function ScanMap({ c, lat, lon, scans, onOpenImage }) {
  const s = makeStyles(c);
  const mapRef = useRef(null);

  // Prioritize pins by risk, cap at MAX_PINS (25)
  const prioritized = sortByRisk(scans).slice(0, MAX_PINS);
  const hasCoords = prioritized.filter((i) => i.lat != null && i.lon != null);

  useEffect(() => {
    if (hasCoords.length === 0 || !mapRef.current) return;
    const coords = [
      { latitude: lat, longitude: lon },
      ...hasCoords.map((i) => ({ latitude: parseFloat(i.lat), longitude: parseFloat(i.lon) })),
    ];
    mapRef.current.fitToCoordinates(coords, { edgePadding: { top: 40, right: 40, bottom: 40, left: 40 }, animated: true });
  }, [hasCoords, lat, lon]);

  // Big highlighted blue dot at the provided lat/lon (target)
  const targetDot = (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      <View style={{
        width: 22, height: 22, borderRadius: 11, backgroundColor: c.mapDot,
        borderWidth: 3, borderColor: '#fff',
        shadowColor: c.mapDot, shadowOpacity: 0.9, shadowRadius: 10, elevation: 10,
      }} />
      <View style={{
        position: 'absolute', width: 44, height: 44, borderRadius: 22,
        borderWidth: 2, borderColor: c.mapDot, opacity: 0.5,
      }} />
    </View>
  );

  return (
    <View style={s.card}>
      <Text style={s.sectionTitle}>SCAN MAP</Text>
      <MapView
        ref={mapRef}
        provider={PROVIDER_DEFAULT}
        style={s.map}
        initialRegion={{ latitude: lat, longitude: lon, latitudeDelta: 0.01, longitudeDelta: 0.01 }}
        showsUserLocation
      >
        {prioritized.map((img, idx) => {
          if (img.lat == null || img.lon == null) return null;
          // Only yellow (caution) and green (clear) pins are shown per request;
          // high/medium severity scans are demoted to yellow so the map stays
          // uncluttered with a single "raised" tier, while the blue target dot
          // remains the single highest-priority marker.
          const col =
            riskColor(c, img.risk_severity) === c.green ? c.green : c.yellow;
          const sym = col === c.yellow ? 'L' : '·';
          return (
            <Marker key={idx} coordinate={{ latitude: parseFloat(img.lat), longitude: parseFloat(img.lon) }} onPress={() => onOpenImage(img)}>
              <View style={[s.imgPin, { borderColor: col }]}>
                <Text style={[s.imgPinTxt, { color: col }]}>{sym}</Text>
              </View>
            </Marker>
          );
        })}
        {/* Target marker rendered LAST so the blue dot sits above every pin. */}
        <Marker coordinate={{ latitude: lat, longitude: lon }} title="TARGET" description="Provided coordinates" zIndex={1000}>
          {targetDot}
        </Marker>
      </MapView>
      <Text style={s.subNote}>
        ■ blue dot = target  ·  {prioritized.length}/{scans.length} pins shown (top risk)  ·  tap pin for image
      </Text>
    </View>
  );
}
