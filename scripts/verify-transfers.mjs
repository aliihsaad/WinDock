import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm, mkdir, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, PassThrough } from 'node:stream';
import { createHash, randomBytes } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { spawnSync } from 'node:child_process';
import { createTransfers, transferName, transferBatch } from '../src/transfers.js';
import { createApp } from '../server.js';
import { EventEmitter } from 'node:events';
import { openReceiveDirectory } from '../src/transfer-desktop.js';

let checks=0;
const equal=(a,b)=>{assert.deepEqual(a,b);checks++;};
const ok=value=>{assert.ok(value);checks++;};
const rejects=async(fn,pattern)=>{await assert.rejects(fn,pattern);checks++;};
const id=()=>randomBytes(16).toString('hex'), owner='a'.repeat(64), other='b'.repeat(64);
const metadata=(name,size=null)=>({id:id(),files:[{id:id(),name,size,mime:'application/octet-stream'}]});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const directory=await mkdtemp(join(tmpdir(),'windock-files-test-'));
const receivers=[];let app;
async function receiver(options={}) { const r=await createTransfers({destination:join(directory,id()),...options});receivers.push(r);return r; }
async function deliver(r,batch,bytes) { await r.begin(owner,batch);const uploaded=await r.upload(owner,batch.id,batch.files[0].id,Readable.from([bytes]));equal(uploaded.sha256,hash(bytes));return r.complete(owner,batch.id,batch.files[0].id,{bytes:bytes.length,sha256:hash(bytes)}); }
try {
  // Interactive file managers must be visible; launch failures must reach the caller.
  for(const platform of ['win32','linux']) {
    let detached=false;
    await openReceiveDirectory(directory,platform,(command,args,options)=>{
      equal(command,platform==='win32'?'explorer.exe':'xdg-open');equal(args,[directory]);
      equal(options.windowsHide,false);equal(options.shell,false);
      const child=new EventEmitter();child.unref=()=>{detached=true;};queueMicrotask(()=>child.emit('spawn'));return child;
    });
    ok(detached);
  }
  await rejects(()=>openReceiveDirectory(directory,'win32',()=>{const child=new EventEmitter();queueMicrotask(()=>child.emit('error',Object.assign(new Error('sensitive system detail'),{code:'ENOENT'})));return child;}),error=>error.status===503 && !error.message.includes('sensitive'));
  await rejects(()=>openReceiveDirectory(directory,'linux',()=>{throw Error('failed to spawn')}),/Could not open/);
  for(const name of ['../escape.txt','..\\escape.txt','C:\\evil.exe','CON','nul.txt','LPT1.exe','.','..','x:stream','a\u202etxt.exe','file\0.txt']) {
    const safe=transferName(name);ok(safe && !/[\\/:\x00-\x1f\u202e]/.test(safe) && !/^[. ]|[. ]$/.test(safe));
  }
  equal(transferName('مرحبا photo 🙂.jpg'),'مرحبا photo 🙂.jpg');
  ok(Buffer.byteLength(transferName('🙂'.repeat(200)+'.pdf'))<=180);
  const unusualExtension=transferName('photo.'+'🙂'.repeat(30));
  ok(unusualExtension.isWellFormed());equal(transferName(unusualExtension),unusualExtension);
  for(const value of [metadata('x',-1),metadata('x',9*1024**3),{...metadata('x'),destination:'/etc'},metadata('x',1.5)]) {assert.throws(()=>transferBatch(value));checks++;}
  const r=await receiver({stateFile:join(directory,'state','state.json')});
  const bytes=Buffer.from([0,255,13,10,128,22,0,1]);const batch=metadata('مرحبا photo 🙂.bin',bytes.length);
  const completed=await deliver(r,batch,bytes);equal(completed.files[0].status,'completed');
  equal(await readFile(join(r.local().destination,completed.files[0].savedName)),bytes);
  equal(await r.complete(owner,batch.id,batch.files[0].id,{bytes:bytes.length,sha256:hash(bytes)}),completed);
  equal((await readdir(r.local().destination)).filter(n=>n!=='.windock-incoming').length,1);
  await rejects(()=>r.begin(other,batch),/identifier/);
  assert.throws(()=>r.status(other,batch.id),/not found/);checks++;
  await rejects(()=>r.upload(owner,batch.id,batch.files[0].id,Readable.from([bytes])),/already been received/);
  const duplicate=metadata(batch.files[0].name,bytes.length);const duplicateResult=await deliver(r,duplicate,bytes);
  ok(duplicateResult.files[0].savedName.includes('(1)'));
  const longName=transferName('🙂'.repeat(100)+'.bin');
  await deliver(r,metadata(longName,bytes.length),bytes);
  const longDuplicate=metadata(longName,bytes.length);
  const longResult=await deliver(r,longDuplicate,bytes);
  ok(longResult.files[0].savedName.includes('(1)'));
  const invalid=metadata('integrity.bin',bytes.length);await r.begin(owner,invalid);await r.upload(owner,invalid.id,invalid.files[0].id,Readable.from([bytes]));
  await rejects(()=>r.complete(owner,invalid.id,invalid.files[0].id,{bytes:bytes.length,sha256:'0'.repeat(64)}),/verification/);
  ok(!(await readdir(r.local().destination)).includes('integrity.bin'));
  const unknown=metadata('unknown length.bin');equal((await deliver(r,unknown,bytes)).completed,true);
  const empty=metadata('empty',0);equal((await deliver(r,empty,Buffer.alloc(0))).completed,true);
  const many={id:id(),files:[{id:id(),name:'one',size:1,mime:'text/plain'},{id:id(),name:'two',size:1,mime:'text/plain'}]};
  await r.begin(owner,many);
  for(const file of many.files){await r.upload(owner,many.id,file.id,Readable.from([Buffer.from('x')]));await r.complete(owner,many.id,file.id,{bytes:1,sha256:hash('x')});}
  equal(r.status(owner,many.id).completed,true);
  const interrupted=metadata('interrupted');await r.begin(owner,interrupted);const stream=new PassThrough();
  const writing=r.upload(owner,interrupted.id,interrupted.files[0].id,stream).catch(e=>e);stream.write(bytes);
  await new Promise(done=>setTimeout(done,40));stream.destroy(new Error('lost connection'));ok((await writing) instanceof Error);
  equal(r.status(owner,interrupted.id).files[0].status,'failed');
  equal((await deliver(r,interrupted,bytes)).completed,true);
  const cancelled=metadata('cancelled');await r.begin(owner,cancelled);const cancelStream=new PassThrough();
  const cancelWrite=r.upload(owner,cancelled.id,cancelled.files[0].id,cancelStream).catch(e=>e);cancelStream.write(bytes);
  await new Promise(done=>setTimeout(done,40));await r.cancel(owner,cancelled.id);ok((await cancelWrite) instanceof Error);equal(r.status(owner,cancelled.id).files[0].status,'cancelled');
  const sizeMismatch=metadata('changed',20);await r.begin(owner,sizeMismatch);
  await rejects(()=>r.upload(owner,sizeMismatch.id,sizeMismatch.files[0].id,Readable.from([bytes])),/changed size/);
  const noSpace=await receiver({diskSpace:async()=>0});await rejects(()=>noSpace.begin(owner,metadata('x',1)),/insufficient storage/);
  let freeChecks=0;const diskFull=await receiver({diskSpace:async()=>++freeChecks===1?1024**3:0});const fullBatch=metadata('diskfull',9*1024**2);await diskFull.begin(owner,fullBatch);
  await rejects(()=>diskFull.upload(owner,fullBatch.id,fullBatch.files[0].id,Readable.from([Buffer.alloc(9*1024**2)])),/insufficient storage/);
  const revoked=metadata('revoked');await r.begin(owner,revoked);await rejects(()=>r.upload(owner,revoked.id,revoked.files[0].id,Readable.from([bytes]),()=>false),/authorized/);await r.cancel(owner,revoked.id);
  const disabled=await receiver();await disabled.configure({enabled:false});await rejects(()=>disabled.begin(owner,metadata('x')),/disabled/);
  const liveReceiver=await receiver();const liveBatch=metadata('revoked-in-flight');await liveReceiver.begin(owner,liveBatch);
  let authorized=true;const liveStream=new PassThrough();const liveWrite=liveReceiver.upload(owner,liveBatch.id,liveBatch.files[0].id,liveStream,()=>authorized).catch(e=>e);
  liveStream.write(bytes);await new Promise(done=>setTimeout(done,40));authorized=false;liveStream.end(bytes);
  ok((await liveWrite) instanceof Error);ok(!(await readdir(liveReceiver.local().destination)).includes('revoked-in-flight'));
  const offBatch=metadata('disabled-in-flight');await liveReceiver.begin(owner,offBatch);const offStream=new PassThrough();
  const offWrite=liveReceiver.upload(owner,offBatch.id,offBatch.files[0].id,offStream).catch(e=>e);offStream.write(bytes);
  await new Promise(done=>setTimeout(done,40));await liveReceiver.configure({enabled:false});ok((await offWrite) instanceof Error);
  equal(liveReceiver.status(owner,offBatch.id).files[0].status,'cancelled');
  await rejects(()=>disabled.configure({destination:'../outside'}),/Invalid/);
  await rejects(()=>disabled.configure({enabled:'yes'}),/Invalid/);
  const target=join(directory,'target');await mkdir(target);const linked=join(directory,'linked');await symlink(target,linked,process.platform==='win32'?'junction':'dir');
  await rejects(()=>disabled.configure({destination:linked}),/real, writable/);
  // Simulate a crash after publication but before the final completed receipt is saved.
  const journal=JSON.parse(await readFile(join(directory,'state','state.json'),'utf8'));
  journal.batches.find(b=>b.id===longDuplicate.id).files[0].status='committing';
  await writeFile(join(directory,'state','state.json'),JSON.stringify(journal));
  const restored=await receiver({stateFile:join(directory,'state','state.json')});equal(restored.status(owner,batch.id).completed,true);
  equal(restored.status(owner,longDuplicate.id).files[0].savedName,longResult.files[0].savedName);
  equal((await restored.begin(owner,longDuplicate)).completed,true);
  equal((await readdir(restored.local().destination)).filter(n=>n.startsWith(longName.slice(0,10))).length,2);
  equal((await restored.begin(owner,batch)).completed,true);
  const expired=await receiver({stateFile:join(directory,'state','state.json'),now:()=>Date.now()+25*3600000});
  equal(expired.local().batches.length,0);
  equal(JSON.parse(await readFile(join(directory,'state','state.json'),'utf8')).batches.length,0);
  const bounded=await receiver({limits:{files:50,fileBytes:1024,batchBytes:2048}});const oversized=metadata('oversized');await bounded.begin(owner,oversized);
  await rejects(()=>bounded.upload(owner,oversized.id,oversized.files[0].id,Readable.from([Buffer.alloc(2048)])),/limit/);
  const large=await receiver();const largeBytes=64*1024**2, chunk=Buffer.alloc(65536,0xa5), largeBatch=metadata('large.bin',largeBytes);await large.begin(owner,largeBatch);
  const started=performance.now();const uploaded=await large.upload(owner,largeBatch.id,largeBatch.files[0].id,Readable.from((function*(){for(let i=0;i<largeBytes/chunk.length;i++)yield chunk;})()));
  await large.complete(owner,largeBatch.id,largeBatch.files[0].id,{bytes:largeBytes,sha256:uploaded.sha256});equal(large.status(owner,largeBatch.id).completed,true);
  console.log(`64 MiB streamed through receiver and disk verification in ${((performance.now()-started)/1000).toFixed(2)}s (local synthetic test, not phone throughput).`);
  const openssl=process.platform==='win32'&&existsSync('C:/Program Files/Git/usr/bin/openssl.exe')?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl';
  const generated=spawnSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=WinDock transfer test only','-addext','subjectAltName=IP:127.0.0.1','-keyout',join(directory,'test.key'),'-out',join(directory,'test.crt')],{encoding:'utf8'});equal(generated.status,0);
  const cert=await readFile(join(directory,'test.crt')), key=await readFile(join(directory,'test.key'));
  const network=await receiver();
  app=await createApp({provider:{id:'test',displayName:'Test',listRunningApps:async()=>[]},configStore:{load:async()=>({tiles:[]})},pin:'123456',securePin:'567890',tls:{cert,key},transfers:network,trustLoopback:false,updates:{state:()=>({})}});
  for(const server of [app.server,app.secureServer])await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const secure=`https://127.0.0.1:${app.secureServer.address().port}`, plain=`http://127.0.0.1:${app.server.address().port}`;
  async function call(origin,path,{method='GET',body,cookie,headers={},ca=cert}={}) {
    return new Promise((done,reject)=>{const request=(origin.startsWith('https:')?httpsRequest:httpRequest)(origin+path,{method,ca,headers:{origin,...(cookie?{cookie}:{}),...headers}},response=>{let data='';response.on('data',c=>data+=c);response.on('end',()=>done({status:response.statusCode,data:JSON.parse(data),headers:response.headers}));});request.on('error',reject);request.end(body===undefined?undefined:Buffer.isBuffer(body)?body:JSON.stringify(body));});
  }
  equal((await call(secure,'/api/transfers/info')).status,401);
  const secureAuth=await call(secure,'/api/auth',{method:'POST',body:{pin:'567890'}});const cookie=secureAuth.headers['set-cookie'][0].split(';')[0];
  const plainAuth=await call(plain,'/api/auth',{method:'POST',body:{pin:'123456'}});const plainCookie=plainAuth.headers['set-cookie'][0].split(';')[0];
  equal((await call(plain,'/api/transfers/info',{cookie:plainCookie})).status,403);
  equal((await call(secure,'/api/transfers/info',{cookie})).status,200);
  equal((await call(secure,'/api/transfers',{cookie,method:'POST',body:metadata('evil'),headers:{origin:'https://evil.invalid'}})).status,403);
  equal((await call(secure,'/api/transfers/local/settings',{cookie,method:'POST',body:{enabled:false}})).status,403);
  const wire=metadata('../network.bin',bytes.length);equal((await call(secure,'/api/transfers',{cookie,method:'POST',body:wire})).status,200);
  const wireUpload=await call(secure,`/api/transfers/${wire.id}/${wire.files[0].id}/content`,{cookie,method:'PUT',body:bytes});equal(wireUpload.status,200);equal(wireUpload.data.sha256,hash(bytes));
  equal((await call(secure,`/api/transfers/${wire.id}/${wire.files[0].id}/complete`,{cookie,method:'POST',body:{bytes:bytes.length,sha256:hash(bytes)}})).data.completed,true);
  equal((await call(plain,'/api/transfers/local',{headers:{'x-windock-files':'local'}})).status,200);
  await rejects(()=>call(secure,'/api/transfers/info',{cookie,ca:[]}),/certificate|self.signed/);
  console.log(`${checks} assertions\ntransfers verification passed`);
} finally {
  if(app){await app.inputHub.close();await app.hub.close();for(const server of [app.secureServer,app.server]){server.closeAllConnections();await new Promise(done=>server.close(done));}}
  for(const receiver of receivers)await receiver.close();
  await rm(directory,{recursive:true,force:true});
}
