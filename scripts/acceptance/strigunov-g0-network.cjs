// Test-only provider boundary. Internal Docker network supplies an independent deny layer.
const fs=require('node:fs'),net=require('node:net');
const allowed=new Set(['127.0.0.1:33001','127.0.0.1:33100','127.0.0.1:33101']);
const deny=target=>{fs.appendFileSync('/work/finishline-results/outbound-attempts.ndjson',JSON.stringify({pid:process.pid,kind:'external-network-denied',target:String(target).split('?')[0].slice(0,150)})+'\n');throw Error('G0_EXTERNAL_NETWORK_DENIED');};
const originalFetch=globalThis.fetch;
globalThis.fetch=(input,options)=>{const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(!allowed.has(u.host))return deny(u.origin);return originalFetch(input,options);};
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){let a=args[0];if(Array.isArray(a))a=a[0];if(typeof a==='object'&&a?.path)return deny('unix-socket');const port=typeof a==='object'?a.port:a;const host=typeof a==='object'?(a.host||'localhost'):(typeof args[1]==='string'?args[1]:'localhost');if(!allowed.has(host+':'+port))return deny(host+':'+port);return connect.apply(this,args);};
