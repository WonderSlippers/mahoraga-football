import {spawn} from 'node:child_process';
import {existsSync,readFileSync,mkdtempSync} from 'node:fs';
import path from 'node:path';

const profile=mkdtempSync(path.resolve('.local-backups/chrome-quote-qa-'));
const chrome=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',[
  '--headless=new','--disable-gpu','--no-first-run','--disable-extensions','--disable-background-networking',
  '--remote-debugging-port=0',`--user-data-dir=${profile}`,'http://127.0.0.1:5173/legacy.html'
],{windowsHide:true,stdio:'ignore'});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
  const deadline=Date.now()+20000,portFile=path.join(profile,'DevToolsActivePort');
  while(!existsSync(portFile)&&Date.now()<deadline)await sleep(200);
  if(!existsSync(portFile))throw new Error('Chrome 调试端口未就绪');
  const port=Number(readFileSync(portFile,'utf8').split(/\r?\n/)[0]);
  const tabs=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const tab=tabs.find(row=>row.type==='page'&&row.url.includes('/legacy.html'));
  if(!tab)throw new Error('赛事页标签未打开');
  const socket=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  const evaluate=()=>new Promise((resolve,reject)=>{
    const id=Math.floor(Math.random()*1e9),timer=setTimeout(()=>reject(new Error('DOM 读取超时')),5000);
    const listener=event=>{const row=JSON.parse(event.data);if(row.id!==id)return;socket.removeEventListener('message',listener);clearTimeout(timer);resolve(row.result?.result?.value||{});};
    socket.addEventListener('message',listener);socket.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression:'({body:document.body.innerText,research:document.querySelector("#research-dashboard")?.textContent||"",labBoot:document.querySelector("#simulation-dashboard")?.dataset.labBoot||""})',returnByValue:true}}));
  });
  const now=Date.now();
  const expectedReferenceCount=now<Date.parse('2026-09-24T16:00:00Z')?8:now<Date.parse('2026-09-24T18:45:00Z')?7:0;
  let snapshot={body:'',research:'',labBoot:''};
  for(let i=0;i<30;i++){
    snapshot=await evaluate();
    if(snapshot.research.split('外部网页参考价').length-1>=expectedReferenceCount&&snapshot.research.includes('国家队重点研究队列'))break;
    await sleep(1000);
  }
  socket.close();
  const body=snapshot.research||'';
  const visibleReferenceCount=body.split('外部网页参考价').length-1;
  console.log(JSON.stringify({research:body.includes('国家队重点研究队列'),expectedReferenceCount,visibleReferenceCount,bet365:body.includes('bet365'),sourceWarning:body.includes('账户可成交价未验证'),labBoot:snapshot.labBoot}));
  if(!body.includes('国家队重点研究队列')||visibleReferenceCount!==expectedReferenceCount||!body.includes('账户可成交价未验证'))process.exitCode=1;
}finally{chrome.kill();}
