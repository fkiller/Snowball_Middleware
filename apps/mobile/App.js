import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, SafeAreaView, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import { fetch as nativeFetch } from 'expo/fetch';
import { listSessions, RemoteAccessError, validateOrigin, validateToken } from './remote.mjs';
import { createConnectionLifecycle } from './connection-lifecycle.mjs';
import { prepareConnection, isConnectionApprovalCurrent } from './connection-approval.mjs';
import { createConnectionStorage } from './connection-storage.mjs';
import { VERIFIED_GATEWAY_CONNECTION_AVAILABLE } from './connection-policy.mjs';

const STORAGE_KEY = 'snowball.experimental.remote.v1';
const storeOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export default function App() {
  const [origin, setOrigin] = useState('');
  const [token, setToken] = useState('');
  const [remember, setRemember] = useState(false);
  const [sessions, setSessions] = useState(null);
  const [checkedAt, setCheckedAt] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [storageState, setStorageState] = useState('ready');
  const lifecycle = useRef(createConnectionLifecycle());
  const busyRef = useRef(false);
  const draft = useRef({ origin: '', token: '', revision: 0, active: !['background', 'inactive'].includes(AppState.currentState) });
  const storedMayExist = useRef(false);
  const storageStateRef = useRef('ready');
  const clearing = useRef(null);
  const clearSequence = useRef(0);
  const storage = useRef(null);
  if (!storage.current) storage.current = createConnectionStorage({
    get: () => SecureStore.getItemAsync(STORAGE_KEY, storeOptions),
    set: value => SecureStore.setItemAsync(STORAGE_KEY, value, storeOptions),
    remove: () => SecureStore.deleteItemAsync(STORAGE_KEY, storeOptions),
  });

  function updateStorageState(value) {
    storageStateRef.current = value;
    setStorageState(value);
  }

  function clearStoredBinding() {
    const sequence = ++clearSequence.current;
    updateStorageState('clearing');
    const operation = storage.current.clear();
    clearing.current = operation;
    operation.then(() => {
      if (sequence !== clearSequence.current) return;
      storedMayExist.current = false;
      updateStorageState('ready');
    }, () => {
      if (sequence !== clearSequence.current) return;
      storedMayExist.current = true;
      updateStorageState('error');
      setMessage('저장된 연결 정보를 지우지 못했습니다. 아래의 연결 정보 삭제를 다시 눌러 주세요.');
    }).finally(() => { if (clearing.current === operation) clearing.current = null; });
    return operation;
  }

  function invalidateStoredBinding() {
    if (storedMayExist.current && !clearing.current && storageStateRef.current !== 'error') void clearStoredBinding().catch(() => {});
  }

  useEffect(() => {
    let mounted = true;
    storage.current.load().then(raw => {
      if (!mounted || !raw) return;
      storedMayExist.current = true;
      try {
        const saved = JSON.parse(raw);
        const savedOrigin = validateOrigin(saved.origin), savedToken = validateToken(saved.token);
        draft.current = { ...draft.current, origin: savedOrigin, token: savedToken };
        setOrigin(savedOrigin);
        setToken(savedToken);
        setRemember(true);
      } catch {
        setMessage('저장된 연결 정보를 읽을 수 없습니다. 다시 입력해 주세요.');
      }
    }).catch(() => { if (mounted) setMessage('보안 저장소를 열 수 없습니다. 직접 입력해 주세요.'); })
      .finally(() => { if (mounted) setReady(true); });
    return () => { mounted = false; lifecycle.current.invalidate(); };
  }, []);

  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {
      if (state !== 'active') {
        lifecycle.current.invalidate();
        draft.current = { ...draft.current, active: false, revision: draft.current.revision + 1 };
        busyRef.current = false;
        setBusy(false);
        setSessions(null);
        setCheckedAt(null);
        setMessage('앱을 벗어나 연결 상태를 지웠습니다. 돌아온 뒤 다시 확인해 주세요.');
      } else draft.current = { ...draft.current, active: true };
    });
    return () => listener.remove();
  }, []);

  function confirmConnect() {
    if (!VERIFIED_GATEWAY_CONNECTION_AVAILABLE) { setMessage('PC의 Snowball 신원 확인이 준비되면 연결할 수 있습니다. 지금은 따로 설정할 필요가 없습니다.'); return; }
    if (storageStateRef.current !== 'ready') { setMessage('저장된 연결 정보를 먼저 삭제해 주세요.'); return; }
    try { validateOrigin(draft.current.origin); }
    catch { setMessage('PC에서 표시한 Tailscale HTTPS 주소를 그대로 입력해 주세요. 경로나 포트는 넣지 않습니다.'); return; }
    try { validateToken(draft.current.token); }
    catch { setMessage('PC에서 발급한 43자의 읽기 자격증명을 입력해 주세요.'); return; }
    const approval = prepareConnection(draft.current.origin, draft.current.token, draft.current.revision);
    Alert.alert('PC 주소 확인', `이 주소가 PC의 Snowball 화면에 표시된 주소와 정확히 같나요? 확인되지 않은 주소로 자격증명을 보내지 마세요.\n\n${approval.origin}`, [
      { text: '취소', style: 'cancel' },
      { text: 'PC와 같음 · 확인', onPress: () => void connect(approval) },
    ]);
  }

  async function connect(approval) {
    if (!VERIFIED_GATEWAY_CONNECTION_AVAILABLE) { setMessage('PC의 Snowball 신원 확인이 준비되면 연결할 수 있습니다.'); return; }
    if (busyRef.current) return;
    if (storageStateRef.current !== 'ready' || !isConnectionApprovalCurrent(approval, draft.current)) {
      setMessage('주소나 자격증명이 변경되었거나 앱을 벗어났습니다. PC 주소를 다시 확인해 주세요.');
      return;
    }
    busyRef.current = true;
    const attempt = lifecycle.current.begin();
    const timeout = setTimeout(() => attempt.abort(), 15000);
    setBusy(true); setSessions(null); setCheckedAt(null); setMessage('');
    try {
      const canonicalOrigin = approval.origin;
      const credential = approval.token;
      const items = await listSessions(canonicalOrigin, credential, nativeFetch, attempt.signal);
      if (!attempt.isCurrent()) return;
      if (attempt.signal.aborted) throw new Error('timeout');
      clearTimeout(timeout);
      const confirmedAt = new Date();
      let storageFailed = false;
      try {
        if (remember) {
          storedMayExist.current = true;
          await storage.current.save(JSON.stringify({ origin: canonicalOrigin, token: credential }));
        } else {
          await storage.current.clear();
          storedMayExist.current = false;
        }
      } catch { storageFailed = true; storedMayExist.current = true; updateStorageState('error'); }
      if (!attempt.isCurrent()) return;
      setSessions(items);
      setCheckedAt(confirmedAt);
      setMessage(storageFailed ? '조회는 완료되었지만 보안 저장소를 변경하지 못했습니다. 연결 정보 저장 상태를 확인해 주세요.' : '조회가 완료되었습니다. 아래는 마지막으로 확인한 상태입니다.');
    } catch (error) {
      if (!attempt.isCurrent()) return;
      const message = attempt.signal.aborted ? '조회 시간이 초과되었습니다. PC와 Tailscale 연결을 확인해 주세요.'
        : error instanceof RemoteAccessError && error.kind === 'unauthorized' ? '자격증명이 만료되었거나 철회되었을 수 있습니다. PC에서 새 읽기 자격증명을 발급해 주세요.'
        : error instanceof RemoteAccessError && error.kind === 'forbidden' ? 'PC가 접속을 거부했습니다. PC에 표시된 주소와 Tailscale 접근 설정을 확인해 주세요.'
        : error instanceof RemoteAccessError && error.kind === 'invalid_response' ? '게이트웨이 응답을 확인할 수 없습니다. PC의 Snowball 버전과 설정을 확인해 주세요.'
        : '조회하지 못했습니다. PC와 Tailscale 연결을 확인해 주세요.';
      setMessage(message);
    } finally {
      clearTimeout(timeout);
      if (attempt.isCurrent()) { busyRef.current = false; setBusy(false); attempt.finish(); }
    }
  }

  async function forget() {
    lifecycle.current.invalidate();
    draft.current = { ...draft.current, origin: '', token: '', revision: draft.current.revision + 1 };
    busyRef.current = false;
    setBusy(false); setSessions(null); setCheckedAt(null); setOrigin(''); setToken(''); setRemember(false); setMessage('');
    try { await clearStoredBinding(); setMessage('이 기기의 저장된 연결 정보를 삭제했습니다. PC에서 자격증명도 철회하세요.'); }
    catch { setMessage('보안 저장소에서 삭제하지 못했습니다. 다시 시도해 주세요.'); }
  }

  return <SafeAreaView style={styles.root}>
    <StatusBar style="auto" />
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.kicker}>SNOWBALL · EXPERIMENTAL</Text>
      <Text style={styles.title}>내 PC에 연결</Text>
      {!VERIFIED_GATEWAY_CONNECTION_AVAILABLE ? <>
        <Text style={styles.body}>PC에 있는 Snowball을 휴대폰에서 안전하게 사용할 수 있도록 연결 기능을 준비하고 있습니다.</Text>
        <Text style={styles.notice}>아직 PC의 Snowball에 직접 연결했는지 안전하게 확인할 수 없어 자격증명을 전송하지 않습니다. 지금 PC나 휴대폰에서 별도로 설정할 필요는 없습니다.</Text>
        <TouchableOpacity style={styles.secondary} onPress={forget} disabled={!ready} accessibilityRole="button"><Text style={styles.secondaryText}>이전에 저장한 연결 정보 삭제</Text></TouchableOpacity>
        {message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}
      </> : <>
      <Text style={styles.body}>1. PC와 휴대폰에 Tailscale을 설치하고 같은 사설망에 연결합니다.{'\n'}2. PC 트레이의 실험용 원격 메뉴에서 표시하는 PC 주소와 읽기 자격증명을 확인합니다.{'\n'}3. 아래에 두 정보를 입력하고 PC 화면의 주소와 비교합니다.</Text>
      <Text style={styles.notice}>실험용 읽기 전용 연결입니다. 주소가 PC 화면과 다르면 자격증명을 보내지 마세요.</Text>
      <Text style={styles.label}>PC의 Tailscale HTTPS 주소</Text>
      <TextInput style={styles.input} value={origin} editable={!busy && ready} onChangeText={value => { draft.current = { ...draft.current, origin: value, token: '', revision: draft.current.revision + 1 }; invalidateStoredBinding(); setOrigin(value); setToken(''); setSessions(null); setCheckedAt(null); setMessage(''); }} placeholder="https://pc.tailnet.ts.net" autoCapitalize="none" autoCorrect={false} autoComplete="off" keyboardType="url" />
      <Text style={styles.label}>게이트웨이 임시 자격증명</Text>
      <TextInput style={styles.input} value={token} editable={!busy && ready} onChangeText={value => { draft.current = { ...draft.current, token: value, revision: draft.current.revision + 1 }; invalidateStoredBinding(); setToken(value); setSessions(null); setCheckedAt(null); setMessage(''); }} placeholder="43자 자격증명" secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="off" textContentType="none" />
      <View style={styles.row}><Text style={styles.body}>이 기기의 보안 저장소에 기억</Text><Switch value={remember} onValueChange={value => { setRemember(value); if (!value) void clearStoredBinding().catch(() => {}); }} disabled={busy || !ready} /></View>
      <Text style={styles.small}>주소가 내 PC의 주소인지 확인하세요. 자격증명은 이 주소에 전송됩니다.</Text>
      <TouchableOpacity style={styles.button} onPress={confirmConnect} disabled={!ready || busy || storageState !== 'ready'} accessibilityRole="button"><Text style={styles.buttonText}>{busy ? '확인 중…' : storageState === 'clearing' ? '이전 연결 정보 삭제 중…' : sessions === null ? '연결 상태 확인' : '다시 확인'}</Text></TouchableOpacity>
      <TouchableOpacity style={styles.secondary} onPress={forget} disabled={!ready} accessibilityRole="button"><Text style={styles.secondaryText}>이 기기에서 연결 정보 삭제</Text></TouchableOpacity>
      {busy ? <ActivityIndicator /> : null}
      {message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}
      {sessions !== null ? <View style={styles.list}>
        <Text style={styles.small}>마지막 확인: {checkedAt?.toLocaleTimeString()} · 실시간 연결 상태가 아닙니다.</Text>
        <Text style={styles.section}>세션 · {sessions.length}</Text>
        {sessions.length === 0 ? <Text style={styles.body}>표시할 세션이 없습니다.</Text> : sessions.map((session, index) => <View style={styles.item} key={`${session.harnessPluginId}-${index}`}>
          <Text style={styles.itemTitle}>{session.harnessPluginId}</Text>
          <Text style={styles.small}>{session.status}</Text>
        </View>)}
      </View> : null}
      </>}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f7f8fc' }, content: { padding: 24, paddingTop: 42, gap: 12 },
  kicker: { color: '#5c54b7', fontWeight: '700', fontSize: 12, letterSpacing: 1 }, title: { color: '#17182d', fontSize: 30, fontWeight: '700' },
  body: { color: '#41465d', fontSize: 15, lineHeight: 22 }, notice: { backgroundColor: '#eeedfb', color: '#3e3a78', padding: 14, borderRadius: 12, lineHeight: 20 },
  label: { color: '#24263c', fontWeight: '700', marginTop: 8 }, input: { backgroundColor: '#fff', borderColor: '#d6d9e4', borderWidth: 1, borderRadius: 10, padding: 13, color: '#17182d' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, small: { color: '#636a80', fontSize: 12, lineHeight: 18 },
  button: { backgroundColor: '#554ac3', padding: 15, alignItems: 'center', borderRadius: 10 }, buttonText: { color: 'white', fontWeight: '700' },
  secondary: { padding: 10, alignItems: 'center' }, secondaryText: { color: '#554ac3' }, message: { color: '#383c50', lineHeight: 21 },
  list: { gap: 8, marginTop: 12 }, section: { color: '#17182d', fontSize: 19, fontWeight: '700' }, item: { backgroundColor: '#fff', borderRadius: 10, padding: 14, gap: 4 }, itemTitle: { color: '#17182d', fontSize: 15, fontWeight: '600' },
});
