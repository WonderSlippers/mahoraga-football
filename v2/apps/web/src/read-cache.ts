type Entry = { value: any; at: number };
const snapshots = new Map<string, Entry>();
const pending = new Map<string, Promise<any>>();
let epoch = 0;
export const readSnapshot = (path: string) => snapshots.get(path)?.value;
export function invalidateReads(path?: string) {
  if (path) snapshots.delete(path);
  else {
    epoch++;
    snapshots.clear();
    pending.clear();
  }
}
export function cachedRead(path: string, load: () => Promise<any>) {
  const saved = snapshots.get(path);
  if (saved && Date.now() - saved.at < 8000)
    return Promise.resolve(saved.value);
  const running = pending.get(path);
  if (running) return running;
  const generation = epoch;
  const task = load()
    .then((value) => {
      if (generation === epoch) {
        snapshots.set(path, { value, at: Date.now() });
        // Keep only navigation snapshots; exports can contain thousands of records.
        if (snapshots.size > 64)
          snapshots.delete(snapshots.keys().next().value!);
      }
      return value;
    })
    .finally(() => {
      if (pending.get(path) === task) pending.delete(path);
    });
  pending.set(path, task);
  return task;
}
