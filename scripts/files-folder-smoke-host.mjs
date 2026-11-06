// Windows folder-window regression fixture; no real companion state or file contents.
import { writeFile } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { createApp } from '../server.js';
import { createTransfers } from '../src/transfers.js';
const artifacts=resolve(import.meta.dirname,'../artifacts');
const directory=resolve(process.env.WINDOCK_FOLDER_SMOKE_ROOT || '');
if(!directory.startsWith(artifacts+sep+'files-folder-test-'))throw Error('Use an isolated test directory');
const receiver=await createTransfers({destination:join(directory,'receive')});
const app=await createApp({transfers:receiver,provider:{id:'folder-test',displayName:'Test',listRunningApps:async()=>[]},
  configStore:{load:async()=>({tiles:[]})},updates:{state:()=>({})}});
await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
await writeFile(join(directory,'port.txt'),String(app.server.address().port));
setTimeout(()=>process.exit(),30000).unref();
