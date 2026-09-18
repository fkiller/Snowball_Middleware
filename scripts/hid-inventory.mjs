// Explicit read-only diagnostic. Does not open device handles or read input reports.
import { createRequire } from 'node:module';
const hid = createRequire(import.meta.url)('node-hid');
const devices = await hid.devicesAsync();
const counts = new Map();
for (const d of devices) {
  const key = JSON.stringify({ vendorId: d.vendorId, productId: d.productId, usagePage: d.usagePage ?? null, usage: d.usage ?? null, interface: d.interface, release: d.release });
  counts.set(key, (counts.get(key) ?? 0) + 1);
}
console.log(JSON.stringify({ platform: process.platform, arch: process.arch, node: process.version, backend: 'node-hid 3.4.0', collectedAt: new Date().toISOString(), enumerationOnly: true, openedHandles: 0, collections: [...counts].map(([descriptor, count]) => ({ ...JSON.parse(descriptor), count })) }, null, 2));
