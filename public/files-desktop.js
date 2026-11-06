const $=id=>document.getElementById(id); let refreshing=false, initialized=false;
async function request(path='',body) {
  const response=await fetch('/api/transfers/local'+path,{method:body===undefined?'GET':'POST',headers:{'x-windock-files':'local','content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
  const value=await response.json(); if(!response.ok)throw Error(value.error||'The transfer settings could not be updated.'); return value;
}
function size(n){const scale=n>=1024**3?1024**3:n>=1024**2?1024**2:n>=1024?1024:1;return new Intl.NumberFormat(undefined,{maximumFractionDigits:1}).format(n/scale)+' '+({1:'B',1024:'KB',1048576:'MB',1073741824:'GB'}[scale]);}
async function refresh() {
  if(refreshing)return; refreshing=true;
  try {
    const value=await request(); $('enabled').checked=value.enabled;
    if(!initialized || document.activeElement!==$('destination'))$('destination').value=value.destination;
    if(!initialized)$('status').textContent='Only securely paired devices can send files.'; initialized=true;
    const list=$('batches');list.replaceChildren();
    for(const batch of value.batches.slice().reverse()) {
      const section=document.createElement('div');section.className='batch';
      for(const file of batch.files) {
        const row=document.createElement('div');row.className='file';
        const title=document.createElement('div');title.className='name';title.textContent=file.savedName||file.name;
        const status=document.createElement('div');status.className='details';status.textContent=`${file.status} · ${size(file.bytes)}${file.size===null?'':' / '+size(file.size)}${file.error?' · '+file.error:''}`;
        row.append(title,status);
        if(file.status==='sending'){const progress=document.createElement('progress');if(file.size!==null){progress.max=Math.max(file.size,1);progress.value=file.bytes;}row.append(progress);}
        section.append(row);
      }
      if(batch.files.some(f=>['ready','sending','uploaded'].includes(f.status))){const cancel=document.createElement('button');cancel.textContent='Cancel batch';cancel.addEventListener('click',()=>act('/cancel',{id:batch.id}));section.append(cancel);}
      list.append(section);
    }
    if(!value.batches.length)list.textContent='Choose files in WinDock on your phone, or Share → WinDock from another app.';
  }catch(error){$('status').textContent=error.message;}finally{refreshing=false;}
}
async function act(path,body){try{await request(path,body);$('status').textContent=path==='/open'?'Receive folder opened.':'Receive settings updated.';await refresh();}catch(error){$('status').textContent=error.message;}}
$('enabled').addEventListener('change',()=>act('/settings',{enabled:$('enabled').checked}));
$('save').addEventListener('click',()=>act('/settings',{destination:$('destination').value}));
$('open').addEventListener('click',()=>act('/open',{}));
refresh();setInterval(()=>{if(!document.hidden)refresh();},1000);
