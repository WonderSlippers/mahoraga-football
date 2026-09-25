// Local-only simulated writes: the Wrangler task binds to loopback:5173.
// Cross-origin browser requests are never included, even on the same PC.
export function isLocalSimulationWrite(urlValue:string,origin:string|null){
  try{
    const url=new URL(urlValue);
    return url.protocol==='http:'&&url.port==='5173'
      &&['localhost','127.0.0.1'].includes(url.hostname)
      &&(origin==null||origin===url.origin);
  }catch{return false;}
}
