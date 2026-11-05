// Development-only browser boundary. No Supervisor proxy, mutation routes,
// client certificate provisioning, or Tailscale configuration is provided.
import https from 'node:https';
import tls from 'node:tls';
import {createHash, createPrivateKey, X509Certificate} from 'node:crypto';
import fs from 'node:fs';
import {parseTailscaleHost} from '../../packages/api/dist/index.js';

const html=Buffer.from(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Snowball · Remote</title><link rel="stylesheet" href="/style.css"><script defer src="/client.js"></script></head><body><main><header><span class="brand">SNOWBALL</span><span class="badge">읽기 전용 원격 PoC</span></header><h1>세션 상태</h1><button id="refresh" type="button">새로 고침</button><p id="message" role="status"></p><ul id="sessions"></ul></main></body></html>`);
const js=Buffer.from(`'use strict';async function refresh(){const msg=document.getElementById('message'),list=document.getElementById('sessions');list.replaceChildren();msg.textContent='확인 중…';try{const response=await fetch('/remote/v1/sessions',{cache:'no-store',credentials:'same-origin',redirect:'error'});if(!response.ok)throw Error();const data=await response.json();for(const session of data.sessions){const li=document.createElement('li');li.textContent=session.harnessPluginId+' · '+session.status;list.appendChild(li)}msg.textContent=data.sessions.length?'':'표시할 세션이 없습니다.'}catch{msg.textContent='연결을 확인하지 못했습니다.'}}document.getElementById('refresh').addEventListener('click',refresh);refresh();`);
const css=fs.readFileSync(new URL('./style.css',import.meta.url));
const policy="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export class RemoteBrowserGateway {
  #server; #origin=''; #closed=false; #sessions; #allowed; #host;
  constructor({host, cert, key, serverCA, clientCA, clientFingerprints, sessionService}) {
    this.#host=parseTailscaleHost(host);
    const certificate=new X509Certificate(cert), privateKey=createPrivateKey(key), anchor=new X509Certificate(serverCA);
    if(certificate.checkHost(this.#host,{subject:'never',wildcards:false})!==this.#host||!certificate.checkPrivateKey(privateKey)||
       !anchor.ca||anchor.issuer!==anchor.subject||!anchor.verify(anchor.publicKey)||!certificate.checkIssued(anchor)||!certificate.verify(anchor.publicKey)||
       Date.now()<Date.parse(anchor.validFrom)||Date.now()>=Date.parse(anchor.validTo)||Date.now()<Date.parse(certificate.validFrom)||Date.now()>=Date.parse(certificate.validTo))throw Error('Invalid server identity');
    if(!Array.isArray(clientCA)||!clientCA.length||!Array.isArray(clientFingerprints)||!clientFingerprints.length||clientFingerprints.length>16||clientFingerprints.some(x=>typeof x!=='string'||!/^[a-f0-9]{64}$/.test(x)))throw Error('Explicit client trust required');
    this.#allowed=new Set(clientFingerprints);this.#sessions=sessionService;
    const context=tls.createSecureContext({cert,key,ca:clientCA,minVersion:'TLSv1.2'});
    this.#server=https.createServer({cert,key,ca:clientCA,requestCert:true,rejectUnauthorized:true,minVersion:'TLSv1.2',maxHeaderSize:8192,requestTimeout:10000,headersTimeout:10000,keepAliveTimeout:1000,
      SNICallback:(name,callback)=>name.toLowerCase()===this.#host?callback(null,context):callback(Error('Unrecognized server name'))},(req,res)=>this.#route(req,res));
    this.#server.maxConnections=16;
  }
  async start(){if(this.#closed||this.#origin)throw Error('Already started or closed');await new Promise((resolve,reject)=>{this.#server.once('error',reject);this.#server.listen(0,'127.0.0.1',resolve)});this.#origin=`https://127.0.0.1:${this.#server.address().port}`;return this.#origin;}
  // Trusted local caller only. Revocation immediately retires existing sockets;
  // subsequent TLS sessions still face the fingerprint check on every request.
  revoke(fingerprint){if(typeof fingerprint!=='string'||!this.#allowed.delete(fingerprint))return false;this.#server.closeAllConnections();return true;}
  #send(res,status,type,body){res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':policy,'X-Frame-Options':'DENY','Cross-Origin-Resource-Policy':'same-origin'});res.end(body);}
  #route(req,res){
    const deny=(status=403)=>this.#send(res,status,'text/plain; charset=utf-8','Denied');
    const cert=req.socket.getPeerCertificate();
    if(!req.socket.authorized||!req.socket.servername||req.socket.servername.toLowerCase()!==this.#host||!cert.raw||!this.#allowed.has(createHash('sha256').update(cert.raw).digest('hex')))return deny();
    const counts=new Map();for(let i=0;i<req.rawHeaders.length;i+=2){const h=req.rawHeaders[i].toLowerCase();counts.set(h,(counts.get(h)||0)+1)}
    if(['host','origin','sec-fetch-site','content-length'].some(h=>(counts.get(h)||0)>1))return deny(400);
    const expected=this.#host;const authority=req.headers.host;
    if(authority!==expected&&authority!==`${expected}:443`)return deny();
    if(req.headers.origin!==undefined&&req.headers.origin!==`https://${expected}`)return deny();
    if(req.headers['sec-fetch-site']!==undefined&&!['none','same-origin'].includes(req.headers['sec-fetch-site']))return deny();
    if(req.method!=='GET'||!req.url||req.url.includes('?')||req.url.includes('#')||req.headers['transfer-encoding']!==undefined||(req.headers['content-length']!==undefined&&req.headers['content-length']!=='0'))return deny(400);
    if(req.url==='/')return this.#send(res,200,'text/html; charset=utf-8',html);
    if(req.url==='/client.js')return this.#send(res,200,'text/javascript; charset=utf-8',js);
    if(req.url==='/style.css')return this.#send(res,200,'text/css; charset=utf-8',css);
    if(req.url==='/remote/v1/sessions'){
      try{const sessions=this.#sessions.snapshotSessions().slice(0,256).map(s=>({status:['idle','busy','error'].includes(s.status)?s.status:'unknown',harnessPluginId:typeof s.harnessPluginId==='string'&&s.harnessPluginId.length<=128&&/^[a-z][a-z0-9-]*\.[a-z][a-z0-9.-]*$/.test(s.harnessPluginId)?s.harnessPluginId:'unknown'}));const data=JSON.stringify({sessions});if(Buffer.byteLength(data)>65536)return deny(503);return this.#send(res,200,'application/json; charset=utf-8',data)}catch{return deny(503)}
    }
    return deny(404);
  }
  async close(){if(this.#closed)return;this.#closed=true;if(this.#server.listening)await new Promise((resolve,reject)=>{this.#server.close(e=>e?reject(e):resolve());this.#server.closeAllConnections()});this.#origin='';}
}
