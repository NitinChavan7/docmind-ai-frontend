import { useCallback, useEffect, useRef, useState } from 'react';
import { getUsage } from '../services/usageApi.js';

export default function useUsage(scopeId) {
  const [state, setState] = useState({ scopeId: null, data: null, loading: false, error: '', updatedAt: null });
  const [now, setNow] = useState(Date.now);
  const current = useRef(scopeId), active = useRef(null), queued = useRef(false);
  current.current = scopeId;
  const refresh = useCallback(() => {
    if (!scopeId || current.current !== scopeId) return Promise.resolve(null);
    if (active.current?.scopeId === scopeId) { queued.current = true; return active.current.promise; }
    const controller = new AbortController(), run = { scopeId, controller };
    active.current = run;
    setState(previous => ({ ...previous, scopeId, loading: true, error: '' }));
    run.promise = getUsage({ signal: controller.signal }).then(data => {
      if (active.current === run && current.current === scopeId) setState({ scopeId, data, loading: false, error: '', updatedAt: Date.now() });
      return data;
    }).catch(error => {
      if (!controller.signal.aborted && active.current === run && current.current === scopeId) setState(previous => ({ ...previous, scopeId, loading: false, error: error.status === 404 ? 'The usage service is not available on this backend yet.' : 'Usage could not be refreshed. Please try again.' }));
      return null;
    }).finally(() => {
      if (active.current !== run) return;
      active.current = null;
      if (queued.current) { queued.current = false; refresh(); }
    });
    return run.promise;
  }, [scopeId]);
  useEffect(() => {
    active.current?.controller.abort(); active.current = null; queued.current = false;
    setState({ scopeId, data: null, loading: Boolean(scopeId), error: '', updatedAt: null });
    if (scopeId) refresh();
    return () => { active.current?.controller.abort(); active.current = null; queued.current = false; };
  }, [scopeId, refresh]);
  useEffect(() => {
    if (!scopeId) return;
    const focus = () => { setNow(Date.now()); refresh(); };
    window.addEventListener('focus', focus);
    const tick = setInterval(() => setNow(Date.now()), 30000);
    return () => { window.removeEventListener('focus', focus); clearInterval(tick); };
  }, [scopeId, refresh]);
  const data = state.scopeId === scopeId ? state.data : null;
  const handledReset = useRef(null);
  useEffect(() => {
    const reset = data?.dailyResetAt;
    if (!reset || handledReset.current === scopeId + reset) return;
    const delay = Math.max(0, Date.parse(reset) - Date.now()) + 100;
    const timer = setTimeout(() => { handledReset.current = scopeId + reset; setNow(Date.now()); refresh(); }, Math.min(delay, 2147483647));
    return () => clearTimeout(timer);
  }, [data?.dailyResetAt, scopeId, refresh]);
  return { ...state, data, now, refresh, available: Boolean(data && !state.error) };
}
