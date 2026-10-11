// Prepare public, independently buildable harness plugin repositories under Apache-2.0.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = process.argv[2];
if (!output || !path.isAbsolute(output) || fs.existsSync(output)) {
  throw new Error('Choose a new absolute output directory');
}

const npm = process.env.npm_execpath;
if (!npm || !fs.existsSync(npm)) {
  throw new Error('Run with npm run export:harnesses -- ABSOLUTE_NEW_DIRECTORY');
}

const base = JSON.parse(fs.readFileSync(path.join(root, 'tsconfig.base.json'), 'utf8'));
fs.mkdirSync(output, { recursive: true });

const sdkPack = JSON.parse(
  execFileSync(
    process.execPath,
    [npm, 'pack', path.join(root, 'packages/plugin-sdk'), '--pack-destination', output, '--ignore-scripts', '--json'],
    { encoding: 'utf8', windowsHide: true }
  )
)[0];
const sdkTar = path.join(output, sdkPack.filename);

const targets = [
  { name: 'harness-codex', repoName: 'Snowball_Harness_Codex', provider: 'codex', title: 'Codex CLI' },
  { name: 'harness-opencode', repoName: 'Snowball_Harness_OpenCode', provider: 'opencode', title: 'OpenCode' },
  { name: 'harness-antigravity', repoName: 'Snowball_Harness_Antigravity', provider: 'antigravity', title: 'Google Antigravity' }
];

for (const { name, repoName, provider, title } of targets) {
  const source = path.join(root, 'packages', name);
  const destination = path.join(output, repoName);
  fs.mkdirSync(destination, { recursive: true });
  fs.cpSync(path.join(source, 'src'), path.join(destination, 'src'), { recursive: true, errorOnExist: true });

  const pkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
  pkg.license = 'Apache-2.0';
  pkg.dependencies = { '@snowball/plugin-sdk': `file:vendor/${sdkPack.filename}` };
  pkg.bundledDependencies = ['@snowball/plugin-sdk'];
  pkg.devDependencies = { typescript: '5.9.3', '@types/node': '20.19.43' };
  pkg.engines = { node: '>=22.12' };
  pkg.files = ['dist', 'src', 'README.md', 'README.ko.md', 'LICENSE', 'assets', 'vendor', 'docs', 'scripts'];
  pkg.scripts = {
    build: 'tsc -p tsconfig.json',
    test: 'npm run build && node --test tests/protocol.test.mjs' + (name === 'harness-codex' ? '' : ' tests/adapter.test.mjs'),
    'test:package': 'node scripts/verify-release-package.mjs'
  };

  fs.mkdirSync(path.join(destination, 'vendor'), { recursive: true });
  fs.copyFileSync(sdkTar, path.join(destination, 'vendor', sdkPack.filename));
  fs.writeFileSync(path.join(destination, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  fs.writeFileSync(
    path.join(destination, 'tsconfig.json'),
    JSON.stringify({ ...base, compilerOptions: { ...base.compilerOptions, rootDir: 'src', outDir: 'dist' }, include: ['src/**/*.ts'] }, null, 2) + '\n'
  );
  fs.writeFileSync(path.join(destination, '.gitignore'), 'node_modules/\ndist/\n*.log\n');

  // Copy License and Assets
  if (fs.existsSync(path.join(root, 'LICENSE'))) {
    fs.copyFileSync(path.join(root, 'LICENSE'), path.join(destination, 'LICENSE'));
  }
  const assetsDir = path.join(destination, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  if (fs.existsSync(path.join(root, 'assets/banner.png'))) {
    fs.copyFileSync(path.join(root, 'assets/banner.png'), path.join(assetsDir, 'banner.png'));
  }
  if (fs.existsSync(path.join(root, 'assets/icon.png'))) {
    fs.copyFileSync(path.join(root, 'assets/icon.png'), path.join(assetsDir, 'icon.png'));
  }

  // Tests
  fs.mkdirSync(path.join(destination, 'tests'), { recursive: true });
  const manifest = provider + 'Manifest';
  const testSource = `import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {parseManifest} from '@snowball/plugin-sdk';
import {${manifest}} from '../dist/index.js';

test('independent worker uses SDK protocol and exits on EOF without launching a harness', async () => {
  const m = parseManifest(await ${manifest}());
  const child = spawn(process.execPath, [m.entrypoint], {
    stdio: 'pipe',
    windowsHide: true,
    env: { ...process.env, NODE_OPTIONS: '' }
  });
  const exited = once(child, 'exit');
  const lines = createInterface({ input: child.stdout });
  const output = [];
  child.stderr.resume();
  lines.on('line', line => output.push(JSON.parse(line)));
  const timeout = setTimeout(() => child.kill(), 15000);
  try {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'plugin.initialize', params: { apiVersion: '1.0.0', pluginId: m.id } }) + '\\n');
    const deadline = Date.now() + 12000;
    while (!output.length && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
    assert.equal(output[0]?.result?.pluginId, m.id);
    assert.equal(output[0]?.result?.apiVersion, '1.0.0');
    child.stdin.end();
    const [code] = await exited;
    assert.equal(code, 0);
  } finally {
    clearTimeout(timeout);
    lines.close();
    if (child.exitCode === null) child.kill();
  }
});
`;
  fs.writeFileSync(path.join(destination, 'tests/protocol.test.mjs'), testSource);
  if (provider !== 'codex') {
    let tests = fs.readFileSync(path.join(root, 'tests', name + '.test.mjs'), 'utf8');
    tests = tests.replaceAll(`../packages/${name}/dist/index.js`, '../dist/index.js').replaceAll("'../packages/core/dist/index.js'", "'@snowball/plugin-sdk'");
    fs.writeFileSync(path.join(destination, 'tests/adapter.test.mjs'), tests);
  }

  // Scripts & Docs
  fs.mkdirSync(path.join(destination, 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(root, 'scripts/verify-harness-release-package.mjs'), path.join(destination, 'scripts/verify-release-package.mjs'));

  fs.mkdirSync(path.join(destination, 'docs'), { recursive: true });
  if (provider === 'opencode') {
    fs.copyFileSync(path.join(root, 'docs/middleware/OPENCODE_OWNERSHIP.md'), path.join(destination, 'docs/OWNERSHIP.md'));
    fs.copyFileSync(path.join(root, 'scripts/verify-opencode-isolation.mjs'), path.join(destination, 'scripts/verify-opencode-isolation.mjs'));
  }

  // Readme
  const readmeContent = `<p align="center">
  <img src="assets/banner.png" alt="Snowball Banner" width="100%">
</p>

<h1 align="center">
  <img src="assets/icon.png" width="48" height="48" valign="middle" alt="Snowball Icon">
  Snowball Harness · ${provider === 'codex' ? 'Codex' : provider === 'opencode' ? 'OpenCode' : 'Antigravity'} — Preview
</h1>

<p align="center"><a href="README.md">English</a> | <a href="README.ko.md">한국어</a></p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License: Apache-2.0"></a>
  <img src="https://img.shields.io/badge/Node.js-%3E%3D22.12-brightgreen.svg" alt="Node.js: >=22.12">
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg" alt="Platform">
</p>

Standalone harness plugin for **${title}** in the [Snowball Local Control ecosystem](https://github.com/fkiller/Snowball_Control).

## Install Snowball

[Snowball Middleware's common installer](https://github.com/fkiller/Snowball_Middleware#one-shot-install) includes **MK20**, **M5Stack + FACES**, **Web UI** and every harness plugin by default, without profile selection or USB. M5Stack firmware 0.4.0 and later discovers unknown PCs and pairs the device-selected PC over LAN. For initial firmware or upgrades, USB opens the common native device setup window with current/included versions, improvements, full backup, NVS preservation, reboot checks and reviewed Wi-Fi import or visual device guidance. Included firmware is 0.5.0. Older device firmware needs one upgrade; no USB registration is required per PC. MK20 and all future devices must follow this same bundled preparation journey without separate user registration scripts. The concrete MK20 component adapter handles QMK DFU and SD runtime preparation in the same window with recovery backups and actual boot verification; ordinary LAN pairing requires no USB/ADB. Physical firmware/card acceptance remains separate. Detected device types stay visible together; MK20 also uses actual LAN discovery and old firmware without a version response stays Unknown. Middleware owns installation and PC runtime; Control owns MK20 hardware, and Device M5Stack owns the ESP32 firmware/gateway. Native provider installation and sign-in remain vendor prerequisites.

This plugin provides seamless, sandbox-isolated orchestration between the [Snowball Middleware](https://github.com/fkiller/Snowball_Middleware) host and the local \`${provider}\` native execution environment.

---

## Key Capabilities

- **Zero Simulation**: Direct native interaction with live local CLI processes and runtime sessions without fake/mock delays or synthetic responses.
- **Living Source of Truth**: Scans local caches and native CLI models/variants dynamically; never hardcodes models or supported reasoning effort tiers.
- **Local-First & Sandbox Isolation**: Strictly bounded JSON-RPC protocol over \`@snowball/plugin-sdk\`, running isolated worker processes with entrypoint digest verification.
- **Cross-Platform**: Native worker runtime targets Windows and macOS.

---

## Getting Started

### Prerequisites

- Node.js >= 22.12
- Local \`${provider}\` native CLI environment

### Installation & Build

\`\`\`bash
# Clone repository
git clone https://github.com/fkiller/${repoName}.git
cd ${repoName}

# Install dependencies (using vendored SDK)
npm ci --ignore-scripts

# Build TypeScript
npm run build
\`\`\`

### Running Tests

\`\`\`bash
# Run protocol and adapter test suites
npm test

# Verify release package integrity and manifest digests
npm run test:package
\`\`\`

---

## Architecture & Integration

This plugin implements the Snowball Plugin SDK protocol v1. Detailed specifications and lifecycle hooks are documented in [\`docs/INTEGRATION.md\`](docs/INTEGRATION.md).

${provider === 'opencode' ? 'Ownership and isolation evidence gates are documented in [`docs/OWNERSHIP.md`](docs/OWNERSHIP.md).\n\n' : ''}---

## License

This project is licensed under the Apache-2.0 License - see the [LICENSE](LICENSE) file for details.
`;
  fs.writeFileSync(path.join(destination, 'README.md'), readmeContent);
  const header = readmeContent.slice(0, readmeContent.indexOf('Standalone harness plugin'));
  fs.writeFileSync(path.join(destination, 'README.ko.md'), header + `## Snowball 설치

[Snowball Middleware 공통 설치기](https://github.com/fkiller/Snowball_Middleware#one-shot-install)는 프로필 선택·USB 연결 없이 MK20, M5Stack + FACES, Web UI와 하네스 플러그인 3종을 기본으로 함께 설치합니다. M5Stack 펌웨어 0.4.0 이상은 미등록 PC까지 발견하고 기기에서 선택한 PC를 LAN으로 등록합니다. 최초 펌웨어와 갱신은 USB 연결 시 열리는 공통 네이티브 기기 설정 창에서 현재/제공 버전·개선 사항·전체 백업·NVS 보존·재기동 확인·검토한 Wi-Fi 이관 또는 기기 조작 그림 안내로 진행합니다. 제공 펌웨어는 0.5.0입니다. 이전 펌웨어는 한 번 업그레이드해야 하며 PC마다 USB 등록할 필요는 없습니다. MK20과 모든 미래 디바이스에 별도 사용자 등록 스크립트 없는 같은 기본 포함 준비 여정을 적용합니다. MK20의 구체적인 구성 요소 어댑터가 같은 창에서 QMK DFU·SD 런타임을 복구 백업과 실제 부팅 검증으로 처리하며 일반 LAN 페어링은 USB/ADB 없이 동작합니다. 실물 펌웨어·카드 인수 검증은 별도입니다. 검색된 기기 종류를 함께 표시하고 MK20의 실제 LAN 검색도 받으며 버전 응답이 없는 구 펌웨어는 미확인으로 남깁니다. Middleware는 PC 실행·설치를, Control은 MK20 기기 코드를, Device M5Stack은 ESP32 펌웨어·게이트웨이를 담당합니다. 네이티브 공급자 앱 설치·로그인은 공급자별 사용자 단계입니다.

## 플러그인 개발

Node >=22.12와 이 저장소에 포함된 SDK 패키지를 사용합니다. npm ci --ignore-scripts, npm run build, npm test, npm run test:package를 실행하세요. 워커 런타임은 Windows·macOS 대상입니다.

[공통 아키텍처](https://github.com/fkiller/Snowball_Control/blob/main/docs/ARCHITECTURE.md) · [통합 계약](docs/INTEGRATION.md) · [Apache-2.0](LICENSE)
`);

  // docs/INTEGRATION.md
  fs.writeFileSync(
    path.join(destination, 'docs/INTEGRATION.md'),
    `# Plugin integration reference

This repository is independently buildable and intentionally does not import the Snowball middleware checkout. Its local \`vendor/${sdkPack.filename}\` is the exact prerelease protocol dependency in \`package-lock.json\`; it is not a registry release. Release tarballs also bundle the installed SDK because npm cannot resolve a nested \`file:vendor/...\` dependency in a consumer project.

Start with \`src/manifest.ts\` to see the plugin ID, kind, reviewed worker entrypoint, integrity digest and explicitly declared operations. The middleware's PluginHost validates the manifest, checks the entrypoint digest, starts \`src/worker.ts\` without a shell, performs \`plugin.initialize\`, and dispatches only declared JSON-RPC operations. \`tests/protocol.test.mjs\` demonstrates the independent handshake and EOF cleanup. Provider tests in \`tests/adapter.test.mjs\`, where present, test provider data separately.

The adapter in \`src/index.ts\` translates provider-specific identity, sessions, model catalog and events into the SDK contract. A listed or discovered session is read-only until the middleware explicitly attaches an owner to that exact instance/session. Commands go through the middleware's local API and durable command journal, never directly from a device plugin to a harness. Do not claim create/send/decision/interrupt operations in a new manifest until real-provider receipts and failure behavior have been verified for each operation.

Run \`npm ci --ignore-scripts\` and \`npm test\` on a supported Node version (>=22.12). GitHub Actions checks both Windows and macOS builds. Those CI checks validate portable protocol/fixture behavior.

This project is licensed under the Apache-2.0 License.
`
  );

  // CI Workflow
  fs.mkdirSync(path.join(destination, '.github/workflows'), { recursive: true });
  fs.writeFileSync(
    path.join(destination, '.github/workflows/check.yml'),
    `name: Standalone checks
on: [push, pull_request]
jobs:
  test:
    strategy:
      matrix:
        os: [windows-latest, macos-latest]
    runs-on: \${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
      - run: npm ci --ignore-scripts
      - run: npm test
      - run: npm run test:package
`
  );

  execFileSync(process.execPath, [npm, 'install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: destination,
    stdio: 'inherit',
    windowsHide: true
  });
}

console.log(
  JSON.stringify({
    output,
    repositories: targets.length,
    published: false,
    license: 'Apache-2.0',
    sdkIntegrity: sdkPack.integrity
  })
);
