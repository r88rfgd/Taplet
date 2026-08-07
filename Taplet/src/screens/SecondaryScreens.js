// screens/SecondaryScreens.js — Meds, Docs, Food, Health, Shop
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, Image, Modal, Alert, Linking,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { makeStyles } from '../styles';
import { API_BASE_URL, daysUntil } from '../theme';
import { DatePickerCalendar } from '../components';

// ---------- Meds ----------
export function MedsScreen({ c }) {
  const [items, setItems] = useState([]);
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState('');
  const [showCal, setShowCal] = useState(false);
  const [busy, setBusy] = useState(false);
  const s = makeStyles(c);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/v1/medicines`);
      setItems(await r.json());
    } catch (e) { Alert.alert('Error', 'Cannot reach backend'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!name) return;
    setBusy(true);
    try {
      await fetch(`${API_BASE_URL}/api/v1/medicines`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, expiry }),
      });
      setName(''); setExpiry(''); await load();
    } finally { setBusy(false); }
  };

  const del = async (id) => {
    await fetch(`${API_BASE_URL}/api/v1/medicines`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
    });
    load();
  };

  return (
    <ScrollView contentContainerStyle={[s.body, { backgroundColor: c.bg }]}>
      <View style={s.card}>
        <Text style={s.sectionTitle}>ADD MEDICINE</Text>
        <TextInput style={s.input} placeholder="Name" placeholderTextColor={c.subText} value={name} onChangeText={setName} />
        <TouchableOpacity style={[s.input, { marginTop: 8, justifyContent: 'center' }]} onPress={() => setShowCal(true)}>
          <Text style={{ color: expiry ? c.text : c.subText, fontWeight: '900' }}>
            {expiry ? `Expiry: ${expiry}` : 'SELECT EXPIRY DATE'}
          </Text>
        </TouchableOpacity>
        {showCal && (
          <DatePickerCalendar
            c={c}
            value={expiry}
            onChange={(iso) => setExpiry(iso)}
            onClose={() => setShowCal(false)}
          />
        )}
        <TouchableOpacity style={[s.btn, s.btnPrimary, { marginTop: 8 }]} onPress={add} disabled={busy}>
          <Text style={s.btnText}>{busy ? 'SAVING…' : 'ADD'}</Text>
        </TouchableOpacity>
      </View>
      {items.map((m) => {
        const d = daysUntil(m.expiry);
        const expired = d <= 0;
        const near = d > 0 && d <= 10;
        const warn = d <= 30;
        return (
          <View key={m.id} style={[s.card, expired ? { borderColor: c.red, backgroundColor: c.red, borderWidth: 3 } : (warn ? { borderColor: c.red } : {})]}>
            <View style={s.heroRow}>
              <Text style={[s.cardHdr, expired && { color: '#fff' }]}>{m.name}</Text>
              <TouchableOpacity onPress={() => del(m.id)}><Text style={{ color: expired ? '#fff' : c.red, fontWeight: '900' }}>✕</Text></TouchableOpacity>
            </View>
            <Text style={[s.bodyText, expired && { color: '#fff', fontWeight: '900' }]}>
              Expiry: {m.expiry || '—'} {expired ? '· EXPIRED' : (near ? `· ${d}d LEFT` : (warn ? `· ${d}d` : ''))}
            </Text>
            {expired && <View style={[s.warnTag, { alignSelf: 'flex-start', marginTop: 6, backgroundColor: '#fff' }]}><Text style={{ color: c.red, fontWeight: '900' }}>DISCARD</Text></View>}
            {near && <View style={[s.warnTag, { alignSelf: 'flex-start', marginTop: 6 }]}><Text style={{ color: c.red, fontWeight: '900' }}>EXPIRES SOON</Text></View>}
          </View>
        );
      })}
    </ScrollView>
  );
}

// ---------- Docs ----------
export function DocsScreen({ c }) {
  const [docs, setDocs] = useState([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const s = makeStyles(c);

  const load = useCallback(async (query = '') => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/v1/documents?q=${encodeURIComponent(query)}`);
      setDocs(await r.json());
    } catch (e) { Alert.alert('Error', 'Cannot reach backend'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const pick = async () => {
    setBusy(true);
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], copyToCacheDirectory: true });
      if (res.canceled) return;
      const f = res.assets[0];
      const fd = new FormData();
      fd.append('file', { uri: f.uri, name: f.name, type: f.mimeType || 'application/octet-stream' });
      fd.append('name', f.name);
      await fetch(`${API_BASE_URL}/api/v1/documents`, { method: 'POST', body: fd, headers: { 'Content-Type': 'multipart/form-data' } });
      await load();
    } catch (e) { Alert.alert('Upload failed', String(e)); }
    finally { setBusy(false); }
  };

  return (
    <ScrollView contentContainerStyle={[s.body, { backgroundColor: c.bg }]}>
      <TextInput style={s.input} placeholder="Search documents…" placeholderTextColor={c.subText} value={q} onChangeText={(t) => { setQ(t); load(t); }} />
      <TouchableOpacity style={[s.btn, s.btnPrimary, { marginTop: 8 }]} onPress={pick} disabled={busy}>
        <Text style={s.btnText}>{busy ? 'UPLOADING…' : '+ UPLOAD'}</Text>
      </TouchableOpacity>
      {docs.length === 0 && <Text style={[s.bodyText, { marginTop: 12 }]}>No documents yet.</Text>}
      {docs.map((d) => (
        <View key={d.id} style={s.card}>
          <View style={s.heroRow}>
            <Text style={s.cardHdr}>📄 {d.name}</Text>
            <Text style={{ color: c.subText, fontSize: 11 }}>{d.type}</Text>
          </View>
          {d.type !== '.pdf' && <Image source={{ uri: `${API_BASE_URL}${d.url}` }} style={s.docThumb} resizeMode="cover" />}
        </View>
      ))}
    </ScrollView>
  );
}

// ---------- Food ----------
export function FoodScreen({ c }) {
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState(null);
  const s = makeStyles(c);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/v1/food-log`);
      setLog(await r.json());
    } catch (e) { Alert.alert('Error', 'Cannot reach backend'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const snap = async () => {
    setBusy(true);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (perm.status !== 'granted') { Alert.alert('Need camera permission'); return; }
      const img = await ImagePicker.launchCameraAsync({ base64: false });
      if (img.canceled) return;
      const f = img.assets[0];
      const fd = new FormData();
      fd.append('file', { uri: f.uri, name: 'food.jpg', type: 'image/jpeg' });
      await fetch(`${API_BASE_URL}/api/v1/analyze-food`, { method: 'POST', body: fd, headers: { 'Content-Type': 'multipart/form-data' } });
      await load();
    } catch (e) { Alert.alert('Analysis failed', String(e)); }
    finally { setBusy(false); }
  };

  const maxCal = Math.max(1, ...log.map((e) => Number(e.calories) || 0));

  return (
    <ScrollView contentContainerStyle={[s.body, { backgroundColor: c.bg }]}>
      <TouchableOpacity style={[s.btn, s.btnPrimary]} onPress={snap} disabled={busy}>
        <Text style={s.btnText}>{busy ? 'ANALYZING…' : '📷 QUICK FOOD SCAN'}</Text>
      </TouchableOpacity>

      {log.length > 0 && (
        <View style={s.card}>
          <Text style={s.sectionTitle}>CALORIES OVER TIME</Text>
          <View style={s.graph}>
            {log.slice(-14).map((e, i) => (
              <View key={i} style={s.barWrap}>
                <View style={[s.bar, { height: Math.max(4, ((Number(e.calories) || 0) / maxCal) * 90), backgroundColor: (e.risks?.length ? c.red : c.text) }]} />
                <Text style={s.barLbl}>{i + 1}</Text>
              </View>
            ))}
          </View>
          <Text style={s.subNote}>red = risks detected</Text>
        </View>
      )}

      <Text style={[s.sectionTitle, { marginTop: 12 }]}>FOOD LOG</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {log.length === 0 && <Text style={s.bodyText}>No entries.</Text>}
        {log.map((e) => (
          <TouchableOpacity key={e.id} style={[s.foodCard, { backgroundColor: c.card }]} onPress={() => setSel(e)}>
            <Image source={{ uri: e.image ? `${API_BASE_URL}${e.image}` : '' }} style={s.foodImg} resizeMode="cover" />
            <Text style={s.foodCal}>{e.calories} kcal</Text>
            <Text style={[s.foodRisk, { color: e.risks?.length ? c.red : c.subText }]}>{e.risks?.length ? '⚠ risks' : 'ok'}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Modal visible={!!sel} transparent animationType="slide" onRequestClose={() => setSel(null)}>
        <View style={s.modalBack}>
          <View style={s.modalCard}>
            <TouchableOpacity style={s.modalClose} onPress={() => setSel(null)}><Text style={{ color: c.text, fontWeight: '900' }}>✕ CLOSE</Text></TouchableOpacity>
            <Image source={{ uri: sel?.image ? `${API_BASE_URL}${sel.image}` : '' }} style={s.modalImg} resizeMode="cover" />
            <Text style={[s.foodCal, { marginTop: 8 }]}>{sel?.calories} kcal</Text>
            <Text style={s.sectionTitle}>AI NOTE</Text>
            <Text style={[s.bodyText, { fontWeight: '900', color: c.text }]}>{sel?.description || '—'}</Text>
            <Text style={s.sectionTitle}>RISKS</Text>
            <Text style={[s.bodyText, { color: sel?.risks?.length ? c.red : c.subText }]}>{sel?.risks?.length ? sel.risks.join(', ') : 'None'}</Text>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

// ---------- Health ----------
export function HealthScreen({ c }) {
  const [items, setItems] = useState([]);
  const [sys, setSys] = useState('');
  const [dia, setDia] = useState('');
  const [sugar, setSugar] = useState('');
  const [hr, setHr] = useState('');
  const [busy, setBusy] = useState(false);
  const s = makeStyles(c);

  // Numeric-only filter for vitals inputs.
  const onlyNums = (t) => t.replace(/[^0-9]/g, '');

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/v1/health-data`);
      setItems(await r.json());
    } catch (e) { Alert.alert('Error', 'Cannot reach backend'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!sys && !dia && !sugar && !hr) return;
    const bp = (sys && dia) ? `${sys}/${dia}` : (sys || dia || '');
    setBusy(true);
    try {
      await fetch(`${API_BASE_URL}/api/v1/health-data`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metrics: { blood_pressure: bp, sugar, heart_rate: hr } }),
      });
      setSys(''); setDia(''); setSugar(''); setHr(''); await load();
    } finally { setBusy(false); }
  };

  const del = async (id) => {
    await fetch(`${API_BASE_URL}/api/v1/health-data`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    load();
  };

  const bps = items.slice(-14).map((e) => Number((e.metrics?.blood_pressure || '0/0').split('/')[0]) || 0);
  const maxBp = Math.max(1, ...bps);

  return (
    <ScrollView contentContainerStyle={[s.body, { backgroundColor: c.bg }]}>
      <View style={s.card}>
        <Text style={s.sectionTitle}>LOG VITALS</Text>
        <View style={s.bpRow}>
          <TextInput style={[s.input, s.bpField]} placeholder="Systolic" placeholderTextColor={c.subText} value={sys} onChangeText={(t) => setSys(onlyNums(t))} keyboardType="numeric" />
          <Text style={s.bpSlash}>/</Text>
          <TextInput style={[s.input, s.bpField]} placeholder="Diastolic" placeholderTextColor={c.subText} value={dia} onChangeText={(t) => setDia(onlyNums(t))} keyboardType="numeric" />
        </View>
        <TextInput style={[s.input, { marginTop: 8 }]} placeholder="Blood Sugar (mg/dL)" placeholderTextColor={c.subText} value={sugar} onChangeText={(t) => setSugar(onlyNums(t))} keyboardType="numeric" />
        <TextInput style={[s.input, { marginTop: 8 }]} placeholder="Heart Rate (bpm)" placeholderTextColor={c.subText} value={hr} onChangeText={(t) => setHr(onlyNums(t))} keyboardType="numeric" />
        <TouchableOpacity style={[s.btn, s.btnPrimary, { marginTop: 8 }]} onPress={add} disabled={busy}>
          <Text style={s.btnText}>{busy ? 'SAVING…' : 'SAVE'}</Text>
        </TouchableOpacity>
      </View>
      {items.length > 0 && (
        <View style={s.card}>
          <Text style={s.sectionTitle}>SYSTOLIC TREND</Text>
          <View style={s.graph}>
            {bps.map((v, i) => (
              <View key={i} style={s.barWrap}>
                <View style={[s.bar, { height: Math.max(4, (v / maxBp) * 90), backgroundColor: c.text }]} />
              </View>
            ))}
          </View>
        </View>
      )}
      {items.map((e) => (
        <View key={e.id} style={s.card}>
          <View style={s.heroRow}>
            <Text style={s.cardHdr}>BP {e.metrics?.blood_pressure || '—'}</Text>
            <TouchableOpacity onPress={() => del(e.id)}><Text style={{ color: c.red, fontWeight: '900' }}>✕</Text></TouchableOpacity>
          </View>
          <Text style={s.bodyText}>Sugar {e.metrics?.sugar || '—'} · HR {e.metrics?.heart_rate || '—'}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

// ---------- Allergies (MY allergies) ----------
const ALLERGY_PRESETS = [
  'Alder pollen',
  'Birch pollen',
  'Grass pollen',
  'Mugwort pollen',
  'Olive pollen',
  'Ragweed pollen',
];

export function AllergiesScreen({ c, allergies = [], onChanged }) {
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const s = makeStyles(c);

  const items = allergies;
  const selectedNames = items.map((a) => a.name);

  const add = async (name) => {
    name = (name || '').trim();
    if (!name) return;
    setBusy(true);
    try {
      await fetch(`${API_BASE_URL}/api/v1/allergies`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      });
      setCustom('');
      if (onChanged) await onChanged();
    } finally { setBusy(false); }
  };

  const del = async (id) => {
    await fetch(`${API_BASE_URL}/api/v1/allergies`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
    });
    if (onChanged) await onChanged();
  };

  return (
    <ScrollView contentContainerStyle={[s.body, { backgroundColor: c.bg }]}>
      <Text style={s.sectionTitle}>MY ALLERGIES</Text>
      <Text style={[s.bodyText, { marginBottom: 8 }]}>Select pollens you react to, or add your own.</Text>

      <View style={s.chipWrap}>
        {ALLERGY_PRESETS.map((p) => {
          const active = selectedNames.includes(p);
          return (
            <TouchableOpacity
              key={p}
              style={[s.chip, active && s.chipActive]}
              onPress={() => (active ? null : add(p))}
            >
              <Text style={[s.chipText, active && { color: c.accentText }]}>{p}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={[s.card, { marginTop: 14 }]}>
        <Text style={s.sectionTitle}>ADD CUSTOM</Text>
        <TextInput style={s.input} placeholder="e.g. Dust mites" placeholderTextColor={c.subText} value={custom} onChangeText={setCustom} />
        <TouchableOpacity style={[s.btn, s.btnPrimary, { marginTop: 8 }]} onPress={() => add(custom)} disabled={busy}>
          <Text style={s.btnText}>{busy ? 'SAVING…' : 'ADD'}</Text>
        </TouchableOpacity>
      </View>

      <Text style={[s.sectionTitle, { marginTop: 16 }]}>SELECTED</Text>
      {items.length === 0 && <Text style={s.bodyText}>No allergies yet.</Text>}
      {items.map((a) => (
        <View key={a.id} style={s.card}>
          <View style={s.heroRow}>
            <Text style={s.cardHdr}>⚠ {a.name}</Text>
            <TouchableOpacity onPress={() => del(a.id)}><Text style={{ color: c.red, fontWeight: '900' }}>✕</Text></TouchableOpacity>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

// ---------- Shop ----------
export function ShopScreen({ c }) {
  const [med, setMed] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const s = makeStyles(c);

  const search = async () => {
    if (!med) return;
    setBusy(true); setRes(null);
    try {
      const r = await fetch(`${API_BASE_URL}/api/v1/medicine-prices`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ medicine: med }),
      });
      setRes(await r.json());
    } catch (e) { Alert.alert('Search failed', String(e)); }
    finally { setBusy(false); }
  };

  const handleLinkPress = (url) => {
    Linking.canOpenURL(url).then((ok) => { if (ok) Linking.openURL(url); else Alert.alert('Link error', url); }).catch(() => Alert.alert('Error'));
  };

  return (
    <ScrollView contentContainerStyle={[s.body, { backgroundColor: c.bg }]}>
      <Text style={s.sectionTitle}>BEST PRICE FINDER</Text>
      <TextInput style={s.input} placeholder="Medicine name…" placeholderTextColor={c.subText} value={med} onChangeText={setMed} />
      <TouchableOpacity style={[s.btn, s.btnPrimary, { marginTop: 8 }]} onPress={search} disabled={busy}>
        <Text style={s.btnText}>{busy ? 'SEARCHING…' : 'FIND BEST PRICE'}</Text>
      </TouchableOpacity>
      {res?.answer && (
        <View style={s.card}>
          <Text style={s.sectionTitle}>BEST OVERALL</Text>
          <Text style={[s.bodyText, { fontWeight: '900', color: c.text }]}>{res.answer}</Text>
        </View>
      )}
      {(res?.results || []).map((r, i) => (
        <View key={i} style={s.card}>
          <Text style={s.cardHdr}>{r.title}</Text>
          <Text style={[s.bodyText, { numberOfLines: 3 }]}>{r.content}</Text>
          {r.url ? <Text style={s.link} onPress={() => handleLinkPress(r.url)}>{r.url}</Text> : null}
        </View>
      ))}
    </ScrollView>
  );
}
