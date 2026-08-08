// App.js — TAPLET (brutalist / minimalist entry point)
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  SafeAreaView, StatusBar, View, Text, TouchableOpacity, TextInput, Modal, Image, Alert, Platform, LogBox,
} from 'react-native';

// Suppress the expo-notifications deprecation/compat warnings so they don't
// surface in the app's dev error overlay.
LogBox.ignoreLogs(['expo-notifications']);
import * as Location from 'expo-location';
// #Bounty 7 - Feature Expansion: pull in notification + PDF/share libs
import * as Notifications from 'expo-notifications';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { THEMES, API_BASE_URL, riskColor } from './src/theme';
import { makeStyles } from './src/styles';
import { HomeScreen } from './src/screens/HomeScreen';
import { MedsScreen, DocsScreen, FoodScreen, HealthScreen, ShopScreen, AllergiesScreen } from './src/screens/SecondaryScreens';

const BOTTOM_TABS = [
  { key: 'home', label: 'Home', icon: '🏠' },
  { key: 'food', label: 'Food', icon: '🍎' },
  { key: 'meds', label: 'Meds', icon: '💊' },
  { key: 'shop', label: 'Shop', icon: '🔍'},
];

const DRAWER_TABS = [
  { key: 'docs', label: 'Docs', icon: '📄' },
  { key: 'health', label: 'Health', icon: '❤️' },
  { key: 'allergy', label: 'Allergy', icon: '🌿' },

];

export default function App() {
  const [mode, setMode] = useState('dark');
  const c = THEMES[mode];
  const s = makeStyles(c);
  const [tab, setTab] = useState('home');
  const [lat, setLat] = useState('28.611809710711995');
  const [lon, setLon] = useState('77.21208896263602');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [medicines, setMedicines] = useState([]);
  const [allergies, setAllergies] = useState([]);
  const [allergyMatches, setAllergyMatches] = useState(null);
  const [matchLoading, setMatchLoading] = useState(false);
  const [riskExpanded, setRiskExpanded] = useState(false);
  const [selImg, setSelImg] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [errToast, setErrToast] = useState(null);
  const errToastTimer = useRef(null);

  const showError = useCallback((msg) => {
    console.error('[TAPLET]', msg);
    setErrToast(msg);
    if (errToastTimer.current) clearTimeout(errToastTimer.current);
    errToastTimer.current = setTimeout(() => setErrToast(null), 3500);
  }, []);

  const loadMeds = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/v1/medicines`);
      setMedicines(await r.json());
    } catch (e) {
      showError('Failed to load medicines');
    }
  }, [showError]);
  useEffect(() => { loadMeds(); }, [loadMeds]);

  const loadAllergies = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/v1/allergies`);
      setAllergies(await r.json());
    } catch (e) {
      showError('Failed to load allergies');
    }
  }, [showError]);
  useEffect(() => { loadAllergies(); }, [loadAllergies]);

  // Always (re)compute the allergy match against the current assessment — this
  // runs for both fresh AND cached assessments, and re-runs whenever the user's
  // allergy selections change so the card always reflects "MY allergies".
  const runAllergyMatch = useCallback(async (assessment) => {
    if (!assessment) return;
    setMatchLoading(true);
    setAllergyMatches(null);
    try {
      const m = await fetch(`${API_BASE_URL}/api/v1/allergy-match`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment }),
      });
      setAllergyMatches(await m.json());
    } catch (e) {
      showError('Failed to compute allergy match');
    }
    finally { setMatchLoading(false); }
  }, [showError]);

  useEffect(() => {
    if (data) runAllergyMatch(data);
  }, [data, allergies, runAllergyMatch]);

  // #Bounty 7 - Feature Expansion: configure notifications + watch for matches
  useEffect(() => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ 
        shouldShowBanner: true, 
        shouldShowList: true, 
        shouldPlaySound: true, 
        shouldSetBadge: false 
      }),
    });

    (async () => {
      // 1. Android MUST have a notification channel set BEFORE requesting permissions
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'Alerts',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#FF231F7C',
        });
      }

      // 2. Now it is safe to request permissions
      const { status } = await Notifications.getPermissionsAsync();
      if (status !== 'granted') {
        await Notifications.requestPermissionsAsync();
      }
    })();
  }, []);

  // #Bounty 7 - Feature Expansion: when a matched allergy is RAISED, fire a push notification
  useEffect(() => {
    const matches = allergyMatches?.matches || [];
    const raised = matches.filter((m) => m.detected);
    if (raised.length === 0) return;
    const names = raised.map((m) => m.allergy).join(', ');
    Notifications.scheduleNotificationAsync({
      content: {
        title: '⚠ Allergy Alert',
        body: `Detected: ${names}. Take care in this area.`,
        // route through the Android channel we created so it actually shows
        ...(Platform.OS === 'android' ? { channelId: 'default' } : {}),
      },
      trigger: null,
    }).catch(() => {});
  }, [allergyMatches]);

  const scan = useCallback(async (useGps) => {
    let la = lat, lo = lon;
    if (useGps) {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({});
          la = String(loc.coords.latitude);
          lo = String(loc.coords.longitude);
          setLat(la); setLon(lo);
        } else { Alert.alert('GPS denied', 'Using manual coordinates.'); }
      } catch (e) { Alert.alert('GPS error', 'Using manual coordinates.'); }
    }
    if (!la || !lo) return;
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE_URL}/api/v1/allergy-assessment`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: parseFloat(la), lon: parseFloat(lo), radius_meters: 100 }),
      });
      const assessment = await r.json();
      setData(assessment);
      setRiskExpanded(false);
      // Match is computed by the effect below (also runs for cache hits + allergy changes)
    } catch (e) { Alert.alert('Failed to connect to backend'); }
    finally { setLoading(false); }
  }, [lat, lon]);

  // Fills the header Lat/Lon inputs when a coordinate is picked on the map.
  const applyPicked = useCallback((la, lo) => {
    setLat(la);
    setLon(lo);
  }, []);

  // #Bounty 7 - Feature Expansion: build an HTML summary of the current scan and export/share it as a PDF
  const shareScanPdf = useCallback(async () => {
    if (!data) { Alert.alert('No scan yet', 'Run a scan first.'); return; }
    const gemma = data?.gemma_allergy_assessment || {};
    const meteo = data?.open_meteo_data?.summary || {};
    const matches = allergyMatches?.matches || [];
    const plants = gemma.top_plants || [];
    const rows = (arr, fn) => arr.map(fn).join('');
    const html = `
      <html><head><meta charset="utf-8"><style>
        body{font-family:Helvetica,Arial,sans-serif;padding:24px;color:#111}
        h1{font-size:22px;margin:0 0 4px} h2{font-size:16px;border-bottom:2px solid #111;margin-top:18px}
        .sub{color:#666;font-size:12px;margin-bottom:8px}
        .row{padding:6px 0;border-bottom:1px solid #eee;font-size:13px}
        .badge{font-weight:bold}
      </style></head><body>
        <h1>TAPLET Scan Report</h1>
        <div class="sub">Lat ${lat} · Lon ${lon} · Generated ${new Date().toLocaleString()}</div>
        <h2>Overall Risk</h2>
        <div class="row">Score: ${gemma.overall_risk_score ?? '--'} / Level: ${gemma.overall_risk_level || 'HIGH'}</div>
        <div class="row">Drivers: ${(gemma.primary_risk_drivers || []).join(', ') || '—'}</div>
        <h2>Weather</h2>
        <div class="row">Temp ${meteo.temperature_c ?? '--'}°C · Humidity ${meteo.humidity_pct ?? '--'}% · Wind ${meteo.wind_speed_kmh ?? '--'} km/h</div>
        <h2>My Allergies Matched</h2>
        ${matches.length === 0 ? '<div class="row">None</div>' : rows(matches, (m) => `<div class="row"><span class="badge">${m.allergy}</span> — ${m.detected ? 'RAISED (' + (m.severity || '') + ')' : 'clear'}</div>`)}
        <h2>Top Plants</h2>
        ${plants.length === 0 ? '<div class="row">None</div>' : rows(plants, (p) => `<div class="row"><span class="badge">${p.plant}</span> — ${p.pollen_level || '—'} · ${(p.allergies_triggered || []).join(', ') || '—'}</div>`)}
      </body></html>`;
    try {
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Share Scan PDF' });
      } else {
        Alert.alert('Sharing not available on this device');
      }
    } catch (e) {
      Alert.alert('PDF export failed', String(e));
    }
  }, [data, allergyMatches, lat, lon]);

  const imgUri = selImg?.image_url ? `${API_BASE_URL}${selImg.image_url}` : null;

  return (
    <SafeAreaView style={[s.container, { backgroundColor: c.bg }]}>
      <StatusBar barStyle={mode === 'dark' ? 'light-content' : 'dark-content'} />

      <View style={s.header}>
        <View style={s.headerRow}>
          <Text style={s.logo}>TAPLET</Text>
          <View style={s.headerBtns}>
            <TouchableOpacity style={s.iconBtn} onPress={() => setDrawerOpen(true)}>
              <Text style={s.iconBtnText}>☰ MENU</Text>
              
            </TouchableOpacity>
            <TouchableOpacity style={s.iconBtn} onPress={() => scan(true)}>
              <Text style={s.iconBtnText}>⚡ SCAN</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.iconBtn} onPress={() => setMode(mode === 'dark' ? 'light' : 'dark')}>
              <Text style={s.iconBtnText}>{mode === 'dark' ? '☀' : '☾'}</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={s.coordRow}>
          <TextInput style={s.coord} placeholder="Lat" placeholderTextColor={c.subText} value={lat} onChangeText={setLat} keyboardType="numeric" />
          <TextInput style={s.coord} placeholder="Lon" placeholderTextColor={c.subText} value={lon} onChangeText={setLon} keyboardType="numeric" />
          <TouchableOpacity style={[s.scanManual, s.btnPrimary]} onPress={() => scan(false)}>
            <Text style={s.btnText}>GO</Text>
          </TouchableOpacity>
        </View>
      </View>

      {tab === 'home' && <HomeScreen c={c} loading={loading} data={data} medicines={medicines} allergyMatches={allergyMatches} matchLoading={matchLoading} onToggleRiskExpand={() => setRiskExpanded(!riskExpanded)} riskExpanded={riskExpanded} onOpenImage={setSelImg} onPickCoordinate={applyPicked} onSharePdf={shareScanPdf} />}
      {tab === 'meds' && <MedsScreen c={c} />}
      {tab === 'docs' && <DocsScreen c={c} />}
      {tab === 'food' && <FoodScreen c={c} />}
      {tab === 'health' && <HealthScreen c={c} />}
      {tab === 'allergy' && <AllergiesScreen c={c} allergies={allergies} onChanged={loadAllergies} />}
      {tab === 'shop' && <ShopScreen c={c} />}

      {/* Image detail modal */}
      <Modal visible={!!selImg} transparent animationType="slide" onRequestClose={() => setSelImg(null)}>
        <View style={s.modalBack}>
          <View style={s.modalCard}>
            <TouchableOpacity style={s.modalClose} onPress={() => setSelImg(null)}>
              <Text style={{ color: c.text, fontWeight: '900' }}>✕ CLOSE</Text>
            </TouchableOpacity>
            {imgUri ? <Image source={{ uri: imgUri }} style={s.modalImg} resizeMode="cover" /> : null}
            <View style={s.heroRow}>
              <Text style={s.cardHdr}>Visual Scan</Text>
              <Text style={{ color: riskColor(c, selImg?.risk_severity), fontWeight: '900' }}>
                {String(selImg?.risk_severity || 'unknown').toUpperCase()}
              </Text>
            </View>
            <Text style={s.sectionTitle}>TRIGGERS</Text>
            <Text style={[s.bodyText, { fontWeight: '900', color: c.text }]}>{selImg?.detected_triggers?.join(', ') || '—'}</Text>
            <Text style={s.sectionTitle}>OBSERVATIONS</Text>
            <Text style={[s.bodyText, { fontWeight: '900', color: c.text }]}>{selImg?.observations || '—'}</Text>
          </View>
        </View>
      </Modal>

      {/* Extendable side bar */}
      {drawerOpen && (
        <View style={s.drawerBack}>
          <TouchableOpacity style={s.drawerScrim} activeOpacity={1} onPress={() => setDrawerOpen(false)} />
          <View style={[s.drawer, { backgroundColor: c.bg, borderColor: c.border }]}>
            <View style={s.drawerHead}>
              
              <Text style={[s.drawerTitle, { paddingTop: 100 }]}>MENU</Text>
              <TouchableOpacity style={s.iconBtn} onPress={() => setDrawerOpen(false)}>
                <Text style={s.iconBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
            {DRAWER_TABS.map((t) => {
              const active = tab === t.key;
              return (
                <TouchableOpacity
                  key={t.key}
                  style={[s.drawerItem, active && { backgroundColor: c.accentBg }, t.bottom && s.drawerItemBottom]}
                  onPress={() => { setTab(t.key); setDrawerOpen(false); }}
                >
                  <Text style={[s.navIcon, { fontSize: 20, marginRight: 12 }]}>{t.icon}</Text>
                  <Text style={[s.drawerItemText, { color: active ? c.accent : c.text }]}>{t.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}

      <View style={s.nav}>
        {BOTTOM_TABS.map((t) => {
          const active = tab === t.key;
          return (
            <TouchableOpacity key={t.key} style={s.navItem} onPress={() => setTab(t.key)}>
              <View style={[s.navIconWrap, active && { backgroundColor: c.accent, borderColor: c.accent }]}>
                <Text style={[s.navIcon, { fontSize: 20 }]}>{t.icon}</Text>
              </View>
              <Text style={[s.navText, { color: active ? c.accent : c.subText }]}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Error toast — surfaces network failures instead of silently swallowing them */}
      {errToast && (
        <View style={[s.toast, { backgroundColor: c.red, borderColor: c.red }]}>
          <Text style={{ color: '#fff', fontWeight: '900' }}>⚠ {errToast}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}
