import test from 'node:test';
import assert from 'node:assert/strict';
import {remoteJourneyGuide} from '../journey-guide.mjs';
import {VERIFIED_GATEWAY_CONNECTION_AVAILABLE} from '../connection-policy.mjs';
import fs from 'node:fs';

test('mobile-first guide explains the computer prerequisite without claiming pairing or store availability', () => {
  assert.equal(VERIFIED_GATEWAY_CONNECTION_AVAILABLE, false);
  const ko=remoteJourneyGuide('ko-KR'), en=remoteJourneyGuide('en-US');
  assert.match(ko.intro,/Windows PC 또는 Mac/);
  assert.match(ko.steps.join(' '),/스토어 배포는 아직 준비 중/);
  assert.match(ko.steps.join(' '),/아직 연결할 수 없습니다/);
  assert.match(en.intro,/Windows PC or Mac/);
  assert.match(en.steps.join(' '),/cannot connect this app yet/);
  for(const guide of [ko,en]) {
    assert.equal(guide.steps.length,3);
    assert.doesNotMatch(JSON.stringify(guide),/https?:\/\//);
  }
});

test('preview naming retains the experimental app identities and Android backup protection', () => {
  const {expo}=JSON.parse(fs.readFileSync(new URL('../app.json',import.meta.url),'utf8'));
  assert.match(expo.name,/Preview/);
  assert.equal(expo.ios.bundleIdentifier,'dev.snowball.mobile.experimental');
  assert.equal(expo.android.package,'dev.snowball.mobile.experimental');
  assert.equal(expo.android.allowBackup,false);
});
