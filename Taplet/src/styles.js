// styles.js — Brutalist minimalist shared styles
import { StyleSheet, Platform, StatusBar } from 'react-native';

// Hard edges, no border radius, heavy borders, flat fills.
export const makeStyles = (c) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },

  // Header
  header: {
    padding: 12,
    borderBottomWidth: 2,
    borderColor: c.border,
    backgroundColor: c.bg,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + 12 : 12,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  logo: { fontSize: 26, fontWeight: '900', letterSpacing: 2, color: c.text },
  headerBtns: { flexDirection: 'row', gap: 8 },
  iconBtn: { borderWidth: 2, borderColor: c.border, paddingHorizontal: 12, paddingVertical: 6 },
  iconBtnText: { fontWeight: '900', fontSize: 12, color: c.text },
  coordRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  coord: { flex: 1, borderWidth: 2, borderColor: c.border, paddingHorizontal: 8, height: 38, color: c.text, fontSize: 14 },
  scanManual: { paddingHorizontal: 16, justifyContent: 'center', backgroundColor: c.accentBg },
  btnText: { fontWeight: '900', color: c.accentText },

  // Layout
  body: { padding: 12, paddingBottom: 40 },
  card: {
    borderRadius: 0,
    padding: 14,
    marginTop: 12,
    borderWidth: 2,
    borderColor: c.border,
    backgroundColor: c.card,
  },
  heroCard: {
    borderRadius: 0,
    padding: 16,
    borderWidth: 2,
    borderColor: c.border,
    backgroundColor: c.card,
  },
  kicker: { fontSize: 11, fontWeight: '900', letterSpacing: 1, color: c.subText },
  heroRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroRingRow: { flexDirection: 'row', alignItems: 'center', gap: 18, marginTop: 10 },
  heroRingInfo: { flex: 1 },
  heroRingTitle: { fontSize: 18, fontWeight: '900', marginBottom: 4, color: c.text },
  ringScore: { fontSize: 34, fontWeight: '900', color: c.text },
  ringUnit: { fontSize: 14, color: c.subText },
  ringLevel: { fontSize: 11, fontWeight: '900', letterSpacing: 1, marginTop: 2 },
  cached: { fontSize: 11, marginTop: 6, fontWeight: '900', color: c.green },
  tapHint: { fontSize: 11, marginTop: 4, color: c.subText },

  miniCard: { borderWidth: 2, borderRadius: 0, padding: 10, marginTop: 8, borderColor: c.border },
  plantCard: { borderWidth: 2, borderRadius: 0, padding: 10, marginTop: 8, borderColor: c.border },
  plantName: { fontSize: 14, fontWeight: '900', color: c.text },
  plantPollen: { fontSize: 11, fontWeight: '900', color: c.text },
  plantReason: { fontSize: 11, marginTop: 3, fontStyle: 'italic', color: c.subText },

  // MY ALLERGIES card
  allergyRow: { borderWidth: 2, borderRadius: 0, padding: 10, marginTop: 8, borderColor: c.border },
  allergyBadge: { fontSize: 11, fontWeight: '900', borderWidth: 2, paddingHorizontal: 6, paddingVertical: 2 },

  // Allergy selection chips
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: { borderWidth: 2, borderRadius: 0, paddingHorizontal: 12, paddingVertical: 8, borderColor: c.border, backgroundColor: c.card },
  chipActive: { backgroundColor: c.accentBg, borderColor: c.accentBg },
  chipText: { fontSize: 13, fontWeight: '900', color: c.text },

  sectionTitle: { fontSize: 13, fontWeight: '900', letterSpacing: 1, color: c.text },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 16, marginBottom: 4 },
  subNote: { fontSize: 11, color: c.subText },
  driver: { fontSize: 13, marginTop: 2, color: c.subText },
  // Wrapped, concise body text (no long paragraphs)
  bodyText: { fontSize: 13, marginTop: 4, lineHeight: 18, color: c.subText, flexWrap: 'wrap' },
  metric: { borderWidth: 2, borderRadius: 0, padding: 10, marginRight: 8, minWidth: 80, alignItems: 'center', borderColor: c.border },
  metricL: { fontSize: 10, fontWeight: '900', color: c.subText },
  metricV: { fontSize: 18, fontWeight: '900', marginTop: 2, color: c.text },
  cardHdr: { fontSize: 15, fontWeight: '900', color: c.text },
  warnTag: { fontSize: 11, fontWeight: '900', borderWidth: 2, paddingHorizontal: 6, paddingVertical: 2, borderColor: c.red, color: c.red },

  input: { borderWidth: 2, borderRadius: 0, paddingHorizontal: 10, height: 42, fontSize: 14, color: c.text, borderColor: c.border, backgroundColor: c.card },
  btn: { paddingVertical: 12, alignItems: 'center', borderRadius: 0, borderWidth: 2, borderColor: c.border },
  btnPrimary: { backgroundColor: c.accentBg },
  loadingBox: { marginTop: 16, alignItems: 'center' },

  // Blood pressure: two numeric fields + slash
  bpRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  bpField: { flex: 1 },
  bpSlash: { fontSize: 22, fontWeight: '900', color: c.text },

  docThumb: { width: '100%', height: 160, marginTop: 8, borderWidth: 2, borderRadius: 0, borderColor: c.border },
  graph: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 100, marginTop: 8 },
  barWrap: { alignItems: 'center', flex: 1 },
  bar: { width: '70%', minHeight: 4 },
  barLbl: { fontSize: 9, marginTop: 2, color: c.subText },

  foodCard: { borderWidth: 2, borderRadius: 0, width: 150, marginRight: 10, padding: 8, borderColor: c.border },
  foodImg: { width: '100%', height: 110, backgroundColor: '#333', borderWidth: 2, borderRadius: 0, borderColor: c.border },
  foodCal: { fontSize: 16, fontWeight: '900', marginTop: 6, color: c.text },
  foodRisk: { fontSize: 12, fontWeight: '900', color: c.subText },

  modalBack: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 16 },
  modalCard: { borderWidth: 2, borderRadius: 0, padding: 16, maxHeight: '85%', backgroundColor: c.card, borderColor: c.border },
  modalClose: { alignSelf: 'flex-end', marginBottom: 8, color: c.text, fontWeight: '900' },
  modalImg: { width: '100%', height: 220, borderWidth: 2, backgroundColor: '#333', borderRadius: 0, borderColor: c.border },
  link: { fontSize: 12, marginTop: 4, textDecorationLine: 'underline', paddingVertical: 6, color: c.green },

  // Nav
  nav: {
    flexDirection: 'row',
    borderTopWidth: 2,
    borderColor: c.border,
    backgroundColor: c.bg,
    paddingBottom: Platform.OS === 'ios' ? 24 : 16,
  },
  navItem: { flex: 1, alignItems: 'center', paddingVertical: 10 },
  navIconWrap: {
    width: 42, height: 42, borderRadius: 0, borderWidth: 2,
    borderColor: 'transparent', alignItems: 'center', justifyContent: 'center',
    marginBottom: 3,
  },
  navIcon: { fontSize: 20 },
  navText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.3 },

  // Drawer / side bar
  drawerBack: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50 },
  drawerScrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)' },
  drawer: {
    position: 'absolute', top: 0, left: 0, bottom: 0, width: 260,
    borderRightWidth: 2, paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + 12 : 12,
    paddingHorizontal: 12, paddingBottom: 24,
  },
  drawerHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 34 },
  drawerTitle: { fontSize: 22, fontWeight: '900', letterSpacing: 2, color: c.text },
  drawerItem: { flexDirection: 'row', alignItems: 'center', borderWidth: 2, borderColor: c.border, paddingVertical: 14, paddingHorizontal: 12, marginBottom: 8 },
  drawerItemBottom: { marginTop: 'auto' },
  drawerItemText: { fontSize: 16, fontWeight: '900' },

  // Map-choice modal
  mapModalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderBottomWidth: 2 },
  bigMap: { flex: 1, width: '100%' },
  coordReadout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderTopWidth: 2 },
  coordVal: { fontSize: 16, fontWeight: '900' },
  mapLegend: { flexDirection: 'row', alignItems: 'center', padding: 10, borderTopWidth: 2 },
  legendSwatch: { width: 14, height: 14, marginRight: 8, borderWidth: 1, borderColor: '#000' },

  // Map
  mapCard: { padding: 12 },
  map: { width: '100%', height: 220, marginTop: 8, borderWidth: 2, borderColor: c.border },
  imgPin: { width: 24, height: 24, borderWidth: 2, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center', borderRadius: 0 },
  imgPinTxt: { fontSize: 12, fontWeight: '900' },

  // Weather (brutalist: emoji right, info left)
  weatherRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 2, borderColor: c.border, marginTop: 12, padding: 14, backgroundColor: c.card },
  weatherInfo: { flex: 1 },
  weatherTemp: { fontSize: 30, fontWeight: '900', color: c.text },
  weatherSub: { fontSize: 13, marginTop: 2, color: c.subText, fontWeight: '900' },
  weatherEmojiBox: { paddingLeft: 14, alignItems: 'center', justifyContent: 'center' },

  // Risk bars
  barRow: { marginTop: 8 },
  barLabel: { fontSize: 11, fontWeight: '900', marginBottom: 3, color: c.subText },
  barTrack: { height: 14, borderWidth: 2, borderColor: c.border },
  barFill: { height: 14 },

  // Error toast (surfaces swallowed network errors to the user)
  toast: {
    position: 'absolute',
    top: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + 8 : 40,
    left: 12,
    right: 12,
    zIndex: 100,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 2,
    borderRadius: 0,
    alignItems: 'center',
  },
});
