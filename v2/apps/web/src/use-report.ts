import { useEffect, useRef, useState } from "react";
import { readSnapshot, invalidateReads } from "./read-cache";
type Client = (path: string, body?: unknown, key?: string) => Promise<any>;
export function useReport(
  api: Client,
  path: string,
  revision = 0,
  poll = 30000,
) {
  const [snapshot, setSnapshot] = useState<{ path: string; data: any }>({
    path,
    data: readSnapshot(path),
  });
  const data = snapshot.path === path ? snapshot.data : readSnapshot(path);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(!data);
  const serial = useRef(0);
  const refresh = async (force = false) => {
    const id = ++serial.current;
    if (force) invalidateReads(path);
    setBusy(true);
    try {
      const value = await api(path);
      if (serial.current === id) {
        setSnapshot({ path, data: value });
        setError("");
      }
    } catch (e) {
      if (serial.current === id) setError(String(e));
    } finally {
      if (serial.current === id) setBusy(false);
    }
  };
  useEffect(() => {
    setError("");
    void refresh(revision > 0);
    const timer = setInterval(() => {
      if (!document.hidden) void refresh(true);
    }, poll);
    return () => {
      clearInterval(timer);
      serial.current++;
    };
  }, [api, path, revision, poll]);
  return { data, error, busy, refresh: () => refresh(true) };
}
