import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import { RemoteAccessError } from './remote.mjs';
import { validateFingerprint, validatePairingCode } from './pinned-remote.mjs';
import { developmentReader } from './native-transport.js';
import { createConnectionLifecycle } from './connection-lifecycle.mjs';
import { createConnectionStorage } from './connection-storage.mjs';
import { pairingJourneyGuide, remoteJourneyGuide } from './journey-guide.mjs';

const PAIRED_PC_KEY = 'snowball.paired.pc.v1';
const LEGACY_STORAGE_KEY = 'snowball.experimental.remote.v1';
const storeOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

function validatePairedPcRecord(raw) {
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) throw new Error('invalid');
  const fingerprint = validateFingerprint(parsed.fingerprint);
  if (typeof parsed.tlsServerName !== 'string' || !parsed.tlsServerName.endsWith('.ts.net')) throw new Error('invalid');
  if (!Array.isArray(parsed.endpoints) || !parsed.endpoints.length || parsed.endpoints.some(u => typeof u !== 'string' || !u.startsWith('https://'))) {
    throw new Error('invalid');
  }
  return {
    version: 1,
    pcName: typeof parsed.pcName === 'string' && parsed.pcName.trim() ? parsed.pcName.trim() : 'Snowball PC',
    tlsServerName: parsed.tlsServerName.toLowerCase(),
    fingerprint,
    endpoints: parsed.endpoints,
    deviceId: typeof parsed.deviceId === 'string' ? parsed.deviceId : 'dev_paired',
  };
}

export default function App() {
  const locale = 'ko-KR';
  const fallbackGuide = remoteJourneyGuide(locale);
  const pairGuide = pairingJourneyGuide(locale);

  const [ready, setReady] = useState(false);
  const [pairedPc, setPairedPc] = useState(null);
  const [revokedByPc, setRevokedByPc] = useState(false);
  const [pendingPair, setPendingPair] = useState(null);
  const [showManualCodeInput, setShowManualCodeInput] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [sessions, setSessions] = useState(null);
  const [checkedAt, setCheckedAt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const lifecycle = useRef(createConnectionLifecycle());
  const busyRef = useRef(false);
  const pairedStorage = useRef(null);
  if (!pairedStorage.current) {
    pairedStorage.current = createConnectionStorage({
      get: () => SecureStore.getItemAsync(PAIRED_PC_KEY, storeOptions),
      set: value => SecureStore.setItemAsync(PAIRED_PC_KEY, value, storeOptions),
      remove: () => SecureStore.deleteItemAsync(PAIRED_PC_KEY, storeOptions),
    });
  }

  function describeError(error) {
    if (!(error instanceof RemoteAccessError)) return 'PC와 연결하지 못했습니다. PC에서 Snowball이 켜져 있는지 확인해 주세요.';
    switch (error.kind) {
      case 'invalid_input':
        return '연결 코드 형식이 올바르지 않습니다. PC의 [휴대폰 연결] 화면에서 새 QR 코드를 스캔하거나 연결 코드를 다시 복사해 주세요.';
      case 'unauthorized':
        return '연결 코드가 만료되었거나 PC에서 연결이 해제되었습니다. PC의 [휴대폰 연결] 화면에서 다시 연결해 주세요.';
      case 'forbidden':
        return '요청이 거부되었습니다. 카메라 권한 또는 PC 연결 상태를 확인해 주세요.';
      case 'gateway_identity_unverified':
        return 'PC 인증서 신원을 확인하지 못해 연결을 차단했습니다. PC에서 새 QR 코드를 발급해 다시 시도해 주세요.';
      case 'timeout':
      case 'host_unreachable':
      case 'host_unresolved':
        return 'PC에 연결하지 못했습니다. 휴대폰과 PC가 같은 Wi-Fi에 연결되어 있는지, PC에서 Snowball이 실행 중인지 확인해 주세요.';
      case 'rate_limited':
        return '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';
      case 'cancelled':
        return '';
      default:
        return 'PC와 통신하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    }
  }

  async function refreshSignedSessions(targetPc) {
    const pc = targetPc || pairedPc;
    if (!pc || !developmentReader.available || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage('');
    const attempt = lifecycle.current.begin();
    const timeout = setTimeout(() => attempt.abort(), 15000);
    try {
      const items = await developmentReader.listSignedSessions(pc.endpoints, pc.tlsServerName, pc.fingerprint, attempt.signal);
      if (!attempt.isCurrent()) return;
      clearTimeout(timeout);
      setRevokedByPc(false);
      setSessions(items);
      setCheckedAt(new Date());
      setMessage('');
    } catch (error) {
      if (!attempt.isCurrent()) return;
      if (error instanceof RemoteAccessError && error.kind === 'unauthorized') {
        setRevokedByPc(true);
        setSessions(null);
        setMessage('PC에서 이 휴대폰의 연결이 해제되었습니다. 다시 연결하려면 아래에서 연결 해제를 누른 뒤 새로 연결해 주세요.');
      } else {
        const msg = describeError(error);
        if (msg) setMessage(msg);
      }
    } finally {
      clearTimeout(timeout);
      if (attempt.isCurrent()) {
        busyRef.current = false;
        setBusy(false);
        attempt.finish();
      }
    }
  }

  async function startPairingWithCode(rawCode) {
    if (!developmentReader.available || busyRef.current) return;
    let code;
    try {
      code = validatePairingCode(rawCode);
    } catch (err) {
      setMessage(err.message);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setMessage('PC와 암호화 서명 키를 교환하는 중…');
    const attempt = lifecycle.current.begin();
    const timeout = setTimeout(() => attempt.abort(), 15000);
    try {
      const result = await developmentReader.requestPairing(code, '', attempt.signal);
      if (!attempt.isCurrent()) return;
      clearTimeout(timeout);
      setShowManualCodeInput(false);
      setManualCode('');
      setPendingPair({
        pairingId: result.pairingId,
        deviceId: result.deviceId,
        verificationCode: result.verificationCode,
        pcName: result.pcName || 'Snowball PC',
        tlsServerName: result.tlsServerName,
        fingerprint: result.fingerprint,
        endpoints: result.endpoints,
      });
      setMessage('');
    } catch (error) {
      if (!attempt.isCurrent()) return;
      const msg = describeError(error);
      if (msg) setMessage(msg);
    } finally {
      clearTimeout(timeout);
      if (attempt.isCurrent()) {
        busyRef.current = false;
        setBusy(false);
        attempt.finish();
      }
    }
  }

  async function handleScanQrCode() {
    if (!developmentReader.available || busyRef.current) return;
    setMessage('');
    try {
      const scannedCode = await developmentReader.scanQrCode();
      if (scannedCode) {
        await startPairingWithCode(scannedCode);
      }
    } catch (error) {
      if (error instanceof RemoteAccessError && error.kind === 'cancelled') return;
      if (error instanceof RemoteAccessError && error.kind === 'forbidden') {
        setMessage('카메라 권한이 꺼져 있습니다. 설정에서 카메라를 허용하거나 [복사한 연결 코드로 연결]을 사용해 주세요.');
        setShowManualCodeInput(true);
        return;
      }
      setShowManualCodeInput(true);
      setMessage('카메라를 열 수 없습니다. 연결 코드를 붙여넣어 연결해 주세요.');
    }
  }

  async function handlePastePairingCode() {
    if (!developmentReader.available || busyRef.current) return;
    setMessage('');
    const clip = await developmentReader.readClipboardPairingCode();
    if (clip && clip.startsWith('SBP1.')) {
      await startPairingWithCode(clip);
      return;
    }
    setShowManualCodeInput(true);
    setMessage('클립보드에서 연결 코드를 찾지 못했습니다. PC에서 복사한 연결 코드(SBP1...)를 아래에 붙여넣어 주세요.');
  }

  async function disconnectPairedPc() {
    lifecycle.current.invalidate();
    busyRef.current = false;
    setBusy(false);
    setPendingPair(null);
    setPairedPc(null);
    setRevokedByPc(false);
    setSessions(null);
    setCheckedAt(null);
    try {
      await pairedStorage.current.clear();
      await SecureStore.deleteItemAsync(LEGACY_STORAGE_KEY, storeOptions).catch(() => {});
      setMessage(pairGuide.disconnectDone);
    } catch {
      setMessage(fallbackGuide.forgetFailed);
    }
  }

  // Restore saved paired PC on launch and immediately fetch live sessions
  useEffect(() => {
    let mounted = true;
    pairedStorage.current.load().then(raw => {
      if (!mounted) return;
      if (developmentReader.initialPairingCode && developmentReader.initialPairingCode.startsWith('SBP1.')) {
        void pairedStorage.current.clear().catch(() => {});
        void startPairingWithCode(developmentReader.initialPairingCode);
        return;
      }
      if (!raw) return;
      try {
        const restored = validatePairedPcRecord(raw);
        setPairedPc(restored);
        void refreshSignedSessions(restored);
      } catch {
        void pairedStorage.current.clear().catch(() => {});
      }
    }).catch(() => {}).finally(() => {
      if (mounted) setReady(true);
    });
    return () => {
      mounted = false;
      lifecycle.current.invalidate();
    };
  }, []);

  // Poll pairing approval status while waiting for the user to click [Approve] on the PC
  useEffect(() => {
    if (!pendingPair || !developmentReader.available) return undefined;
    let cancelled = false;
    let pollInFlight = false;
    const timer = setInterval(async () => {
      if (cancelled || pollInFlight || AppState.currentState !== 'active') return;
      pollInFlight = true;
      try {
        const res = await developmentReader.checkPairingStatus(
          pendingPair.endpoints,
          pendingPair.tlsServerName,
          pendingPair.fingerprint
        );
        if (cancelled) return;
        if (res.status === 'approved') {
          clearInterval(timer);
          const approvedPc = {
            version: 1,
            pcName: res.pcName || pendingPair.pcName || 'Snowball PC',
            tlsServerName: pendingPair.tlsServerName,
            fingerprint: pendingPair.fingerprint,
            endpoints: res.activeEndpoint
              ? [res.activeEndpoint, ...pendingPair.endpoints.filter(u => u !== res.activeEndpoint)]
              : pendingPair.endpoints,
            deviceId: res.deviceId || pendingPair.deviceId,
          };
          await pairedStorage.current.save(JSON.stringify(approvedPc)).catch(() => {});
          if (cancelled) return;
          setPendingPair(null);
          setPairedPc(approvedPc);
          void refreshSignedSessions(approvedPc);
        } else if (res.status === 'rejected') {
          clearInterval(timer);
          setPendingPair(null);
          setMessage('PC에서 연결 요청을 거절했습니다.');
        }
      } catch (err) {
        if (!cancelled && err instanceof RemoteAccessError && err.kind === 'unauthorized') {
          clearInterval(timer);
          setPendingPair(null);
          setMessage('연결 요청 시간이 만료되었거나 거절되었습니다. 다시 시도해 주세요.');
        }
      } finally {
        pollInFlight = false;
      }
    }, 1200);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pendingPair]);

  // Refresh sessions automatically when returning to the foreground
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {
      if (state !== 'active') {
        lifecycle.current.invalidate();
        busyRef.current = false;
        setBusy(false);
      } else if (pairedPc) {
        void refreshSignedSessions(pairedPc);
      }
    });
    return () => listener.remove();
  }, [pairedPc]);

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="auto" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.kicker}>SNOWBALL · REMOTE</Text>
        <Text style={styles.title}>{pairedPc ? pairedPc.pcName : pendingPair ? 'PC 승인 대기 중' : pairGuide.title}</Text>

        {!developmentReader.available ? (
          <>
            <Text style={styles.body}>{fallbackGuide.intro}</Text>
            {fallbackGuide.steps.map(step => <Text key={step} style={styles.body}>{step}</Text>)}
            <Text style={styles.notice}>{fallbackGuide.notice}</Text>
          </>
        ) : pendingPair ? (
          <View style={styles.card}>
            <Text style={styles.section}>{pendingPair.pcName} 화면과 번호를 비교하세요</Text>
            <Text style={styles.body}>PC의 Snowball 화면에 아래 6자리 확인 번호가 똑같이 표시되면 PC에서 [승인] 버튼을 눌러 주세요.</Text>
            <View style={styles.sasBox}>
              <Text style={styles.sasText}>
                {pendingPair.verificationCode.slice(0, 3)} - {pendingPair.verificationCode.slice(3)}
              </Text>
            </View>
            <View style={styles.waitingRow}>
              <ActivityIndicator color="#554ac3" />
              <Text style={styles.small}>PC에서 승인을 기다리고 있습니다…</Text>
            </View>
            <TouchableOpacity
              style={styles.secondary}
              onPress={() => { setPendingPair(null); setMessage('연결 요청을 취소했습니다.'); }}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryText}>연결 요청 취소</Text>
            </TouchableOpacity>
          </View>
        ) : pairedPc ? (
          <>
            <View style={[styles.connectedCard, revokedByPc && styles.revokedCard]}>
              <View style={styles.row}>
                <Text style={[styles.connectedBadge, revokedByPc && styles.revokedBadge]}>
                  ● {revokedByPc ? 'PC에서 연결 해제됨' : '연결됨'} · {pairedPc.pcName}
                </Text>
                <Text style={styles.small}>{pairedPc.deviceId}</Text>
              </View>
              <Text style={styles.small}>iOS Keychain P-256 서명 및 전용 인증서 고정(Pinning) 적용됨</Text>
            </View>

            {message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}

            <TouchableOpacity
              style={styles.button}
              onPress={() => void refreshSignedSessions(pairedPc)}
              disabled={busy}
              accessibilityRole="button"
            >
              <Text style={styles.buttonText}>{busy ? '세션 확인 중…' : '🔄 세션 상태 새로고침'}</Text>
            </TouchableOpacity>

            {busy && sessions === null ? <ActivityIndicator style={{ marginTop: 12 }} color="#554ac3" /> : null}

            {sessions !== null ? (
              <View style={styles.list}>
                <Text style={styles.small}>마지막 확인: {checkedAt?.toLocaleTimeString()}</Text>
                <Text style={styles.section}>실행 중인 세션 · {sessions.length}</Text>
                {sessions.length === 0 ? (
                  <Text style={styles.body}>표시할 세션이 없습니다.</Text>
                ) : (
                  sessions.map((session, index) => (
                    <View style={styles.item} key={`${session.harnessPluginId}-${index}`}>
                      <Text style={styles.itemTitle}>{session.harnessPluginId}</Text>
                      <Text style={styles.statusPill}>{session.status}</Text>
                    </View>
                  ))
                )}
              </View>
            ) : null}

            <TouchableOpacity
              style={styles.secondary}
              onPress={() => void disconnectPairedPc()}
              disabled={!ready}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryText}>{pairGuide.disconnectButton}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.body}>{pairGuide.intro}</Text>
            <View style={styles.card}>
              {pairGuide.steps.map(step => (
                <Text key={step} style={styles.stepText}>{step}</Text>
              ))}
            </View>
            <Text style={styles.notice}>{pairGuide.notice}</Text>

            {message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}

            <TouchableOpacity
              style={styles.button}
              onPress={() => void handleScanQrCode()}
              disabled={!ready || busy}
              accessibilityRole="button"
            >
              <Text style={styles.buttonText}>{busy ? '연결 요청 중…' : pairGuide.scanButton}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => void handlePastePairingCode()}
              disabled={!ready || busy}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryButtonText}>{pairGuide.pasteButton}</Text>
            </TouchableOpacity>

            {showManualCodeInput ? (
              <View style={styles.card}>
                <Text style={styles.label}>PC에서 복사한 일회용 연결 코드</Text>
                <TextInput
                  style={styles.input}
                  value={manualCode}
                  editable={!busy}
                  onChangeText={setManualCode}
                  placeholder="SBP1...."
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                />
                <TouchableOpacity
                  style={styles.button}
                  onPress={() => void startPairingWithCode(manualCode)}
                  disabled={busy || !manualCode.trim()}
                  accessibilityRole="button"
                >
                  <Text style={styles.buttonText}>연결 요청 보내기</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f7f8fc' },
  content: { padding: 24, paddingTop: 42, gap: 14 },
  kicker: { color: '#5c54b7', fontWeight: '700', fontSize: 12, letterSpacing: 1 },
  title: { color: '#17182d', fontSize: 28, fontWeight: '800' },
  body: { color: '#41465d', fontSize: 15, lineHeight: 22 },
  stepText: { color: '#24263c', fontSize: 15, lineHeight: 23, fontWeight: '500' },
  notice: { backgroundColor: '#eeedfb', color: '#3e3a78', padding: 14, borderRadius: 12, lineHeight: 20, fontSize: 13 },
  card: { backgroundColor: '#ffffff', borderRadius: 14, padding: 18, gap: 10, borderWidth: 1, borderColor: '#e2e5f0' },
  connectedCard: { backgroundColor: '#eefbf3', borderRadius: 14, padding: 16, gap: 6, borderWidth: 1, borderColor: '#bfe8ce' },
  revokedCard: { backgroundColor: '#fef3f2', borderColor: '#fecdca' },
  connectedBadge: { color: '#136f3a', fontWeight: '700', fontSize: 15 },
  revokedBadge: { color: '#b42318' },
  sasBox: { backgroundColor: '#17182d', borderRadius: 12, paddingVertical: 18, paddingHorizontal: 20, alignItems: 'center', marginVertical: 6 },
  sasText: { color: '#ffffff', fontSize: 32, fontWeight: '800', letterSpacing: 4, fontVariant: ['tabular-nums'] },
  waitingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 4 },
  label: { color: '#24263c', fontWeight: '700' },
  input: { backgroundColor: '#f7f8fc', borderColor: '#d6d9e4', borderWidth: 1, borderRadius: 10, padding: 13, color: '#17182d' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  small: { color: '#636a80', fontSize: 12, lineHeight: 18 },
  button: { backgroundColor: '#554ac3', padding: 16, alignItems: 'center', borderRadius: 12 },
  buttonText: { color: 'white', fontWeight: '700', fontSize: 16 },
  secondaryButton: { backgroundColor: '#ffffff', borderColor: '#554ac3', borderWidth: 1.5, padding: 15, alignItems: 'center', borderRadius: 12 },
  secondaryButtonText: { color: '#554ac3', fontWeight: '700', fontSize: 15 },
  secondary: { padding: 12, alignItems: 'center' },
  secondaryText: { color: '#554ac3', fontWeight: '600' },
  message: { color: '#b42318', backgroundColor: '#fef3f2', padding: 12, borderRadius: 10, lineHeight: 20, fontSize: 14 },
  list: { gap: 8, marginTop: 6 },
  section: { color: '#17182d', fontSize: 18, fontWeight: '700' },
  item: { backgroundColor: '#fff', borderRadius: 12, padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: '#e6e8f0' },
  itemTitle: { color: '#17182d', fontSize: 15, fontWeight: '600' },
  statusPill: { color: '#554ac3', fontSize: 13, fontWeight: '700', backgroundColor: '#eeedfb', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, overflow: 'hidden' },
});
