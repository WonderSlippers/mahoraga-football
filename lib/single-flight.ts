// Share only work with an identical key while it is pending. Settled and
// rejected promises are removed so later requests can refresh or retry.
export function createSingleFlight<K,V>() {
  const pending = new Map<K,Promise<V>>();
  return (key:K, work:()=>Promise<V>):Promise<V> => {
    const existing=pending.get(key);
    if(existing)return existing;
    const task=Promise.resolve().then(work);
    pending.set(key,task);
    const clear=()=>{if(pending.get(key)===task)pending.delete(key);};
    void task.then(clear,clear);
    return task;
  };
}
