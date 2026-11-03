import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, SafeAreaView, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import { fetch as nativeFetch } from 'expo/fetch';
import { listSessions, RemoteAccessError, validateOrigin, validateToken } from './remote.mjs';
import { createConnectionLifecycle } from './connection-lifecycle.mjs';

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
  const lifecycle = useRef(createConnectionLifecycle());
  const writes = useRef(Promise.resolve());
  const enqueueWrite = action => {
    const next = writes.current.catch(() => {}).then(action);
    writes.current = next;
    return next;
  };

  useEffect(() => {
    let mounted = true;
    SecureStore.getItemAsync(STORAGE_KEY, storeOptions).then(raw => {
      if (!mounted || !raw) return;
      try {
        const saved = JSON.parse(raw);
        setOrigin(validateOrigin(saved.origin));
        setToken(validateToken(saved.token));
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
        setBusy(false);
        setSessions(null);
        setCheckedAt(null);
        setMessage('앱을 벗어나 연결 상태를 지웠습니다. 돌아온 뒤 다시 확인해 주세요.');
      }
    });
    return () => listener.remove();
  }, []);

  function confirmConnect() {
    let address;
    try { address = validateOrigin(origin); validateToken(token); }
    catch (error) { setMessage(error.message); return; }
    Alert.alert('PC 주소 확인', `이 주소가 신뢰할 수 있는 경로로 별도 확인한 내 PC 주소인가요? 확인되지 않은 주소에 연결하면 자격증명을 도난당할 수 있습니다.\n\n${address}`, [
      { text: '취소', style: 'cancel' },
      { text: '주소를 확인했고 연결', onPress: connect },
    ]);
  }

  async function connect() {
    if (busy) return;
    const attempt = lifecycle.current.begin();
    const timeout = setTimeout(() => attempt.abort(), 15000);
    setBusy(true); setSessions(null); setCheckedAt(null); setMessage('');
    try {
      const canonicalOrigin = validateOrigin(origin);
      const credential = validateToken(token);
      const items = await listSessions(canonicalOrigin, credential, nativeFetch, attempt.signal);
      if (!attempt.isCurrent()) return;
      if (attempt.signal.aborted) throw new Error('timeout');
      clearTimeout(timeout);
      const confirmedAt = new Date();
      let storageFailed = false;
      try {
        if (remember) {
          await enqueueWrite(() => SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify({ origin: canonicalOrigin, token: credential }), storeOptions));
        } else {
          await enqueueWrite(() => SecureStore.deleteItemAsync(STORAGE_KEY, storeOptions));
        }
      } catch { storageFailed = true; }
      if (!attempt.isCurrent()) return;
      setSessions(items);
      setCheckedAt(confirmedAt);
      setMessage(storageFailed ? '조회는 완료되었지만 보안 저장소를 변경하지 못했습니다. 연결 정보 저장 상태를 확인해 주세요.' : '조회가 완료되었습니다. 아래는 마지막으로 확인한 상태입니다.');
    } catch (error) {
      if (!attempt.isCurrent()) return;
      const message = attempt.signal.aborted ? '조회 시간이 초과되었습니다. PC와 Tailscale 연결을 확인해 주세요.'
        : error instanceof RemoteAccessError && error.kind === 'unauthorized' ? '접근이 거부되었습니다. 자격증명과 PC 게이트웨이 설정을 확인해 주세요.'
        : error instanceof RemoteAccessError && error.kind === 'invalid_response' ? '게이트웨이 응답을 확인할 수 없습니다. PC의 Snowball 버전과 설정을 확인해 주세요.'
        : '조회하지 못했습니다. PC와 Tailscale 연결을 확인해 주세요.';
      setMessage(message);
    } finally {
      clearTimeout(timeout);
      if (attempt.isCurrent()) { setBusy(false); attempt.finish(); }
    }
  }

  async function forget() {
    lifecycle.current.invalidate();
    setBusy(false); setSessions(null); setCheckedAt(null); setOrigin(''); setToken(''); setRemember(false); setMessage('');
    try { await enqueueWrite(() => SecureStore.deleteItemAsync(STORAGE_KEY, storeOptions)); setMessage('이 기기의 저장된 연결 정보를 삭제했습니다. PC에서 자격증명도 철회하세요.'); }
    catch { setMessage('보안 저장소에서 삭제하지 못했습니다. 다시 시도해 주세요.'); }
  }

  return <SafeAreaView style={styles.root}>
    <StatusBar style="auto" />
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.kicker}>SNOWBALL · EXPERIMENTAL</Text>
      <Text style={styles.title}>내 PC에 연결</Text>
      <Text style={styles.body}>내부 개발 실험용입니다. PC 트레이의 실험용 원격 메뉴에서 로컬 리스너와 임시 자격증명을 관리할 수 있습니다. HTTPS 경로와 호스트 설정은 별도로 준비해야 하며 아직 실제 원격 접속 검증은 완료되지 않았습니다.</Text>
      <Text style={styles.notice}>실험용 읽기 전용 연결입니다. 자동 페어링과 명령 전송은 아직 제공되지 않습니다. 자격증명이 만료되거나 PC에서 철회하면 다시 발급받아야 합니다. 주소가 내 PC인지 자동 검증하지 못하므로 신뢰한 PC의 주소를 직접 확인해야 합니다.</Text>
      <Text style={styles.label}>PC의 Tailscale HTTPS 주소</Text>
      <TextInput style={styles.input} value={origin} editable={!busy && ready} onChangeText={value => { setOrigin(value); setToken(''); setSessions(null); setCheckedAt(null); setMessage(''); }} placeholder="https://pc.tailnet.ts.net" autoCapitalize="none" autoCorrect={false} autoComplete="off" keyboardType="url" />
      <Text style={styles.label}>게이트웨이 임시 자격증명</Text>
      <TextInput style={styles.input} value={token} editable={!busy && ready} onChangeText={value => { setToken(value); setSessions(null); setCheckedAt(null); setMessage(''); }} placeholder="43자 자격증명" secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="off" textContentType="none" />
      <View style={styles.row}><Text style={styles.body}>이 기기의 보안 저장소에 기억</Text><Switch value={remember} onValueChange={value => { setRemember(value); if (!value) enqueueWrite(() => SecureStore.deleteItemAsync(STORAGE_KEY, storeOptions)).catch(() => setMessage('보안 저장소에서 삭제하지 못했습니다. 다시 시도해 주세요.')); }} disabled={busy || !ready} /></View>
      <Text style={styles.small}>주소가 내 PC의 주소인지 확인하세요. 자격증명은 이 주소에 전송됩니다.</Text>
      <TouchableOpacity style={styles.button} onPress={confirmConnect} disabled={!ready || busy} accessibilityRole="button"><Text style={styles.buttonText}>{busy ? '확인 중…' : sessions === null ? '연결 상태 확인' : '다시 확인'}</Text></TouchableOpacity>
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
