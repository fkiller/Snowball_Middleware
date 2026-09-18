import os from 'node:os';
import { isIPv4 } from 'node:net';
import dgram from 'node:dgram';
import { randomInt } from 'node:crypto';
import { createRequire } from 'node:module';

export class LanFault extends Error { constructor(readonly code: string) { super(code); } }
export function ensure(value: unknown, code: string): asserts value { if (!value) throw new LanFault(code); }
export interface LocalInterface { name: string; address: string; netmask: string }
const number = (address: string) => address.split('.').reduce((n, p) => (n * 256 + Number(p)) >>> 0, 0);
export const localV4 = (address: string): boolean => isIPv4(address) && (address.startsWith('10.') || address.startsWith('192.168.') || address.startsWith('169.254.') || (Number(address.split('.')[0]) === 172 && Number(address.split('.')[1]) >= 16 && Number(address.split('.')[1]) <= 31));
export function inScope(address: string, selected: LocalInterface): boolean {
  if (!localV4(address) || !localV4(selected.address) || !isIPv4(selected.netmask)) return false;
  const mask = number(selected.netmask), inverse = (~mask) >>> 0;
  if (!mask || ((inverse & (inverse + 1)) >>> 0) !== 0) return false;
  const host = number(address), network = (number(selected.address) & mask) >>> 0;
  if (((host & mask) >>> 0) !== network) return false;
  return inverse <= 1 || (host !== network && host !== ((network | inverse) >>> 0));
}
export function localInterfaces(): LocalInterface[] {
  return Object.entries(os.networkInterfaces()).flatMap(([name, addresses]) => (addresses ?? []).filter(a => a.family === 'IPv4' && !a.internal && localV4(a.address)).map(a => ({ name, address: a.address, netmask: a.netmask })));
}
export interface Question { name: string; type: 'PTR' | 'SRV' | 'TXT' | 'A' }
export interface RecordAnswer { name: string; type: string; ttl?: number; class?: string; data: unknown }
export interface DnsReply { source: string; records: RecordAnswer[] }
interface Packet { id?: number; type?: string; flags?: number; answers?: RecordAnswer[]; additionals?: RecordAnswer[] }
const codec = createRequire(import.meta.url)('dns-packet') as { encode(value: unknown): Buffer; decode(value: Buffer): Packet };
export interface DiscoveryProbe { query(questions: Question[], signal: AbortSignal): Promise<DnsReply[]>; close(): void }

/** Ephemeral socket bound to ONE explicit address. Uses RFC 6762 legacy unicast replies. */
export class MdnsProbe implements DiscoveryProbe {
  private readonly operations = new Set<() => void>();
  private closed = false;
  constructor(private readonly address: string, private readonly target = { address: '224.0.0.251', port: 5353 }, private readonly windowMs = 750) {
    ensure(isIPv4(address) && isIPv4(target.address) && Number.isInteger(target.port) && target.port > 0 && target.port <= 65535 && windowMs > 0 && windowMs <= 3000, 'invalid_probe');
  }
  query(questions: Question[], signal: AbortSignal): Promise<DnsReply[]> {
    ensure(!this.closed && this.operations.size === 0 && questions.length > 0 && questions.length <= 32, 'probe_unavailable');
    if (signal.aborted) return Promise.reject(new LanFault('cancelled'));
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket('udp4'); const id = randomInt(1, 65536); const replies: DnsReply[] = []; let done = false;
      const finish = (error?: LanFault) => {
        if (done) return; done = true; clearTimeout(timer); signal.removeEventListener('abort', cancel); this.operations.delete(cancel);
        try { socket.close(); } catch { /* Not bound yet. */ }
        if (error) reject(error); else resolve(replies);
      };
      const cancel = () => finish(new LanFault('cancelled')); const timer = setTimeout(() => finish(), this.windowMs);
      this.operations.add(cancel); signal.addEventListener('abort', cancel, { once: true });
      socket.on('error', () => finish(new LanFault('network_unavailable')));
      socket.on('message', (bytes, remote) => {
        if (done || remote.port !== this.target.port || bytes.length < 12 || bytes.length > 8192 || replies.length >= 100) return;
        // Bound record counts before entering the decoder, including attacker-controlled DNS counts.
        if ([4,6,8,10].reduce((sum, offset) => sum + bytes.readUInt16BE(offset), 0) > 128) return;
        try {
          const packet = codec.decode(bytes);
          if (packet.type !== 'response' || packet.id !== id || ((packet.flags ?? 0) & 0x020f) !== 0) return;
          const records = [...(packet.answers ?? []), ...(packet.additionals ?? [])];
          replies.push({ source: remote.address, records });
        } catch { /* Malformed packets are not candidates or control instructions. */ }
      });
      socket.bind(0, this.address, () => {
        if (done) { try { socket.close(); } catch {} return; }
        try {
          if (this.target.address === '224.0.0.251') { socket.setMulticastInterface(this.address); socket.setMulticastTTL(255); socket.setMulticastLoopback(false); }
          const bytes = codec.encode({ type: 'query', id, questions: questions.map(q => ({ ...q, class: 'IN' })) });
          socket.send(bytes, this.target.port, this.target.address, error => { if (error) finish(new LanFault('network_unavailable')); });
        } catch { finish(new LanFault('network_unavailable')); }
      });
    });
  }
  close(): void { this.closed = true; for (const close of [...this.operations]) close(); }
}
