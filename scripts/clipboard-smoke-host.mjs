// Isolated UI fixture: no real clipboard, desktop input, or user configuration.
import { createServer } from "node:http";
import { createApp } from "../server.js";
let reads = 0, mode = "ready", focus = "1";
const events = [], emitters = new Set();
const samples = ["Hello from the PC clipboard", "First line\nمرحبا 🙂\tSecond line", "<img src=x onerror=window.clipboardInjected=true>", "A copied link: https://example.com"];
const app = await createApp({ pin:"864213",trustLoopback:false,configStore:{load:async()=>({tiles:[]})},provider:{
  id:"clipboard-fixture",displayName:"Clipboard test PC",listInstalledApps:async()=>[],listRunningApps:async()=>[],
  clipboard:{async history(){reads++;await new Promise(resolve=>setTimeout(resolve,100));return {status:mode,items:mode==="ready"?samples.map(text=>({text})):[]};}},
  input:{open(_fail,emit){emitters.add(emit);const announce=()=>emit({type:"focus",target:focus,editable:true,password:false});announce();return {ready:Promise.resolve(),close(){emitters.delete(emit);},send(message){if(message.type==="focus")announce();if(message.type==="paste"){events.push(message);setTimeout(()=>emit(message.target===focus?{type:"paste-result"}:{type:"input-error"}),30);}}};},dispose(){}},
}});
const control=createServer((req,res)=>{
  const url=new URL(req.url,"http://127.0.0.1");
  if(url.pathname==="/mode")mode=url.searchParams.get("value")||"ready";
  if(url.pathname==="/focus"){focus=url.searchParams.get("value")||"1";for(const emit of emitters)emit({type:"focus",target:focus,editable:true,password:false});}
  res.writeHead(200,{"content-type":"application/json","cache-control":"no-store"});res.end(JSON.stringify({reads,events,mode,focus}));
});
control.listen(18628,"127.0.0.1");
app.server.listen(18627,"127.0.0.1",()=>console.log("Clipboard fixture ready: 18627; control: 18628"));
