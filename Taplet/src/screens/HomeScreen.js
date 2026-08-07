// screens/HomeScreen.js
import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Image, ActivityIndicator, Modal, Clipboard, Platform, StatusBar, Polyline, SafeAreaView } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { makeStyles } from '../styles';
import { riskColor, sortByRisk, daysUntil, API_BASE_URL } from '../theme';
import { RiskRing, RiskBar, WeatherCard, ScanMap } from '../components';

export function HomeScreen({ c, loading, data, medicines, allergyMatches, matchLoading, onToggleRiskExpand, riskExpanded, onOpenImage, onPickCoordinate }) {
  const s = makeStyles(c);
  const gemma = data?.gemma_allergy_assessment || {};
  const meteo = data?.open_meteo_data?.summary || {};
  const visualScans = data?.visual_analysis || [];
  const sortedScans = sortByRisk(visualScans);

  const lat = parseFloat(data?.metadata?.target_location?.lat ?? '28.6083');
  const lon = parseFloat(data?.metadata?.target_location?.lon ?? '77.2209');
  const topPlants = gemma.top_plants || [];

  const matches = allergyMatches?.matches || [];

  // Interactive map-choice modal (adapted from the Mapillary coverage tool):
  // pick a map type (default Standard), tap the map to drop a pin, copy coords.
  const [mapModal, setMapModal] = useState(false);
  const [mapType, setMapType] = useState('standard'); // default choice = standard
  const [picked, setPicked] = useState(null);
  const [coverage, setCoverage] = useState(null); // Mapillary coverage from server

  // Fetch server-side cached/saved Mapillary coverage when the modal opens.
  useEffect(() => {
    if (!mapModal) return;
    setCoverage(null);
    fetch(`${API_BASE_URL}/api/v1/mapillary-coverage?lat=${lat}&lon=${lon}&radius_meters=500`)
      .then((r) => r.json())
      .then((d) => setCoverage(d))
      .catch(() => setCoverage({ points: [], sequences: [] }));
  }, [mapModal, lat, lon]);

  return (
    <ScrollView contentContainerStyle={[s.body, { backgroundColor: c.bg }]}>
      {/* Top hero card with Risk Ring */}
      <TouchableOpacity style={s.heroCard} onPress={onToggleRiskExpand}>
        <Text style={s.kicker}>OVERALL ENVIRONMENTAL RISK</Text>
        <View style={s.heroRingRow}>
          <RiskRing c={c} score={gemma.overall_risk_score} level={gemma.overall_risk_level || 'HIGH'} />
          <View style={s.heroRingInfo}>
            <Text style={s.heroRingTitle}>Allergy Threat Index</Text>
            <Text style={[s.bodyText, { fontWeight: '900', color: c.text }]}>
              {(gemma.primary_risk_drivers || []).slice(0, 2).join(', ') || 'Analyzing…'}
            </Text>
            <Text style={[s.tapHint, { marginTop: 6 }]}>tap to {riskExpanded ? 'collapse' : 'expand'} ↓</Text>
          </View>
        </View>
        {data?.metadata?.cached && <Text style={s.cached}>⚡ CACHE</Text>}
        <TouchableOpacity style={[s.btn, s.btnPrimary, { marginTop: 10 }]} onPress={() => { setPicked(null); setMapModal(true); }}>
          <Text style={s.btnText}>🗺 OPEN MAP PICKER</Text>
        </TouchableOpacity>
      </TouchableOpacity>

      {/* Map with blue target dot + capped pins */}
      {visualScans.length > 0 && (
        <ScanMap c={c} lat={lat} lon={lon} scans={visualScans} onOpenImage={onOpenImage} />
      )}

      {/* MY ALLERGIES — matched against assessment (no cache) */}
      {data && (
        <View style={s.card}>
          <Text style={s.sectionTitle}>MY ALLERGIES</Text>
          {!allergyMatches && matchLoading && (
            <View style={s.heroRow}>
              <Text style={s.bodyText}>Checking against this assessment…</Text>
              <ActivityIndicator color={c.text} />
            </View>
          )}
          {matches.length === 0 && !matchLoading && (
            <Text style={s.bodyText}>No allergies set. Use the 🌿 Allergy tab to add pollens you react to.</Text>
          )}
          {matches.map((mt, i) => {
            const sev = String(mt.severity || '').toLowerCase();
            const sevColor = sev === 'high' ? c.red : sev === 'medium' ? c.orange : c.green;
            return (
              <View key={i} style={s.allergyRow}>
                <View style={s.heroRow}>
                  <Text style={s.cardHdr}>🌿 {mt.allergy}</Text>
                  <Text style={[s.allergyBadge, { color: mt.detected ? sevColor : c.subText, borderColor: mt.detected ? sevColor : c.subText }]}>
                    {mt.detected ? 'RAISED' : 'CLEAR'}
                  </Text>
                </View>
                <Text style={s.bodyText}>
                  {mt.detected
                    ? `Close to it ${mt.occurrences || 0} time(s) · ${sev}`
                    : 'No signal detected'}
                </Text>
                {mt.note ? <Text style={s.plantReason}>{mt.note}</Text> : null}
              </View>
            );
          })}
          {allergyMatches?.error && (
            <Text style={s.bodyText}>Match analysis unavailable.</Text>
          )}
        </View>
      )}

      {/* Weather — emoji right, info left */}
      {data && <WeatherCard c={c} meteo={meteo} />}

      {/* Hourly Timeline */}
      {gemma.hourly_timeline?.length > 0 && (
        <View style={s.card}>
          <Text style={s.sectionTitle}>HOURLY TIMELINE</Text>
          {gemma.hourly_timeline.map((t, i) => (
            <RiskBar key={i} c={c} label={t.time} score={t.score ?? 0} delay={i * 80} />
          ))}
        </View>
      )}

      {/* 7-Day Risk Forecast */}
      {gemma.daily_risk_forecast?.length > 0 && (
        <View style={s.card}>
          <Text style={s.sectionTitle}>7-DAY RISK</Text>
          {gemma.daily_risk_forecast.map((d, i) => (
            <RiskBar key={i} c={c} label={d.day} score={d.score ?? 0} delay={i * 80} />
          ))}
        </View>
      )}

      {riskExpanded && data && (
        <View style={s.card}>
          <Text style={s.sectionTitle}>LIKELY CAUSED BY</Text>
          {(gemma.primary_risk_drivers || []).map((d, i) => (
            <Text key={i} style={s.driver}>› {d}</Text>
          ))}
          <Text style={[s.sectionTitle, { marginTop: 10 }]}>SUMMARY</Text>
          <Text style={[s.bodyText, { fontWeight: '900', color: c.text }]}>{gemma.executive_summary || '—'}</Text>
          <Text style={[s.sectionTitle, { marginTop: 10 }]}>VISUAL SCAN (high→low)</Text>
          {sortedScans.length === 0 && <Text style={s.bodyText}>No scan data.</Text>}
          {sortedScans.map((img, idx) => {
            const imgUri = img.image_url ? `${API_BASE_URL}${img.image_url}` : null;
            return (
              <TouchableOpacity key={idx} style={s.miniCard} onPress={() => onOpenImage(img)}>
                <View style={s.heroRow}>
                  <Text style={s.cardHdr}>#{idx + 1} Visual</Text>
                  <Text style={{ color: riskColor(c, img.risk_severity), fontWeight: '900' }}>
                    {String(img.risk_severity || 'unknown').toUpperCase()}
                  </Text>
                </View>
                {imgUri ? (
                  <Image source={{ uri: imgUri }} style={[s.docThumb, { height: 120 }]} resizeMode="cover" />
                ) : null}
                <Text style={s.bodyText}>{img.detected_triggers?.join(', ') || '—'}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Horizontal metric strip */}
      {data && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }}>
          {[
            ['TEMP', `${meteo.temperature_c ?? '--'}°C`],
            ['HUMID', `${meteo.humidity_pct ?? '--'}%`],
            ['WIND', `${meteo.wind_speed_kmh ?? '--'} km/h`],
            ['AQI', `${meteo.us_aqi ?? '--'}`],
            ['UV', `${meteo.uv_index ?? '--'}`],
          ].map(([l, v], i) => (
            <View key={i} style={s.metric}>
              <Text style={s.metricL}>{l}</Text>
              <Text style={s.metricV}>{v}</Text>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Top Plants */}
      {topPlants.length > 0 && (
        <View style={s.card}>
          <Text style={s.sectionTitle}>TOP 5 PLANTS</Text>
          {topPlants.map((p, i) => {
            const pollenColor =
              String(p.pollen_level).toUpperCase().includes('HIGH') ? c.red :
              String(p.pollen_level).toUpperCase().includes('MOD') ? c.orange :
              String(p.pollen_level).toUpperCase().includes('LOW') ? c.yellow : c.green;
            return (
              <View key={i} style={s.plantCard}>
                <View style={s.heroRow}>
                  <Text style={s.plantName}>{i + 1}. {p.plant}</Text>
                  <Text style={[s.plantPollen, { color: pollenColor }]}>{p.pollen_level || '—'}</Text>
                </View>
                <Text style={s.bodyText}>🌬️ {p.pollen_type || '—'} · 🗓️ {p.peak_season || '—'}</Text>
                <Text style={s.bodyText}>⚠️ {(p.allergies_triggered || []).join(', ') || '—'}</Text>
                {p.presence_reason ? (
                  <Text style={s.plantReason}>why: {p.presence_reason}</Text>
                ) : null}
              </View>
            );
          })}
        </View>
      )}

      {/* Medicines */}
      <View style={s.sectionHead}>
        <Text style={s.sectionTitle}>MEDICINES</Text>
        <Text style={s.subNote}>near expiry highlighted</Text>
      </View>
      {medicines.length === 0 && <Text style={s.bodyText}>No medicines. Use Meds tab.</Text>}
      {medicines.map((m) => {
        const d = daysUntil(m.expiry);
        const warn = d <= 30;
        return (
          <View key={m.id} style={[s.card, warn ? { borderColor: c.red, borderWidth: 2 } : {}]}>
            <View style={s.heroRow}>
              <Text style={s.cardHdr}>{m.name}</Text>
              {warn && <Text style={[s.warnTag]}>{d <= 0 ? 'NOW' : `${d}d`}</Text>}
            </View>
            <Text style={s.bodyText}>Expiry: {m.expiry || '—'}</Text>
          </View>
        );
      })}

      {/* Highlight medicines expiring within 10 days (or already expired) */}
      {(() => {
        const soon = medicines.filter((m) => {
          const d = daysUntil(m.expiry);
          return d <= 10;
        });
        if (soon.length === 0) return null;
        return (
          <View style={[s.card, { borderColor: c.red, borderWidth: 3, backgroundColor: c.red }]}>
            <Text style={[s.sectionTitle, { color: '#fff' }]}>⚠ EXPIRED</Text>
            {soon.map((m) => {
              const d = daysUntil(m.expiry);
              return (
                <View key={m.id} style={s.heroRow}>
                  <Text style={[s.cardHdr, { color: '#fff' }]}>{m.name}</Text>
                  <Text style={[s.warnTag, { backgroundColor: '#fff' }]}>
                    <Text style={{ color: c.red, fontWeight: '900' }}>{d <= 0 ? 'EXPIRED' : `${d}d left`}</Text>
                  </Text>
                </View>
              );
            })}
          </View>
        );
      })()}

      {loading && (
        <View style={s.loadingBox}>
          <ActivityIndicator color={c.text} />
          <Text style={s.bodyText}>running assessment…</Text>
        </View>
      )}

      {/* Interactive map-choice modal */}
      <Modal visible={mapModal} animationType="slide" onRequestClose={() => setMapModal(false)}>
        <SafeAreaView style={[s.modalBack, { backgroundColor: c.bg, padding: 0 }]}>
          <View style={[s.mapModalHead, { borderColor: c.border }]}>
            <Text style={s.drawerTitle}>MAP PICKER</Text>
            <TouchableOpacity style={s.iconBtn} onPress={() => setMapModal(false)}>
              <Text style={s.iconBtnText}>✕ CLOSE</Text>
            </TouchableOpacity>
          </View>

          {/* Map type choice — default = standard */}
          <View style={s.chipWrap}>
            {['standard', 'satellite', 'hybrid'].map((t) => (
              <TouchableOpacity
                key={t}
                style={[s.chip, mapType === t && s.chipActive]}
                onPress={() => setMapType(t)}
              >
                <Text style={[s.chipText, { color: mapType === t ? c.accentText : c.text }]}>
                  {t.toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <MapView
            style={s.bigMap}
            mapType={mapType}
            initialRegion={{ latitude: lat, longitude: lon, latitudeDelta: 0.02, longitudeDelta: 0.02 }}
            onPress={(e) => {
              const { latitude, longitude } = e.nativeEvent.coordinate;
              setPicked({ latitude, longitude });
              // Auto-fill the Lat/Lon header inputs on map tap.
              if (onPickCoordinate) {
                onPickCoordinate(latitude.toFixed(6), longitude.toFixed(6));
              }
            }}
          >
            {/* Mapillary coverage — green points + sequence lines (mirrors HTML coverage layer) */}
            {(coverage?.sequences || []).map((seq, i) => (
              <Polyline key={`seq-${i}`} coordinates={seq} strokeColor={c.green} strokeWidth={2} />
            ))}
            {(coverage?.points || []).map((pt, i) => (
              <Marker key={`pt-${i}`} coordinate={{ latitude: pt.lat, longitude: pt.lon }} pinColor={c.green} />
            ))}

            {/* Picked coordinate */}
            {picked && (
              <Marker coordinate={picked} title="Picked" />
            )}
          </MapView>

          {/* Legend */}
          <View style={[s.mapLegend, { borderColor: c.border }]}>
            <View style={[s.legendSwatch, { backgroundColor: c.green }]} />
            <Text style={[s.bodyText, { color: c.text, marginTop: 0 }]}>Mapillary coverage</Text>
          </View>

          {/* Coordinates readout + copy (adapted from the HTML tool) */}
          <View style={[s.coordReadout, { borderColor: c.border, backgroundColor: c.card }]}>
            <Text style={[s.coordVal, { color: c.text }]}>
              {picked ? `${picked.latitude.toFixed(6)}, ${picked.longitude.toFixed(6)}` : 'tap the map to pick a location'}
            </Text>
            <TouchableOpacity
              style={[s.btn, s.btnPrimary, { paddingVertical: 8, paddingHorizontal: 14 }]}
              disabled={!picked}
              onPress={() => {
                if (!picked) return;
                Clipboard.setString(`${picked.latitude.toFixed(6)}, ${picked.longitude.toFixed(6)}`);
              }}
            >
              <Text style={s.btnText}>COPY</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </ScrollView>
  );
}
