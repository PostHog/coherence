import { useEffect, useRef, useState } from 'react';
import { shareReadings } from './live-state.mjs';

export function useLiveReadings(snapshot) {
  const endpoint = document.querySelector('meta[name="scope-live"]')?.content;
  const [readings, setReadings] = useState(snapshot);
  const [status, setStatus] = useState(endpoint ? 'connecting' : 'snapshot');
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false), pending = useRef(null);
  useEffect(() => {
    if (!endpoint) return;
    const stream = new EventSource(new URL(endpoint, location.href));
    stream.addEventListener('readings', event => {
      try {
        const next = JSON.parse(event.data);
        if (next.version !== 1 || !Array.isArray(next.journal?.records) || !Array.isArray(next.sessions)
          || !['current', 'unavailable'].includes(next.structure?.status)
          || (next.structure.status === 'current' && !Array.isArray(next.structure.model?.nodes))) throw new Error('Invalid reading snapshot');
        setStatus('live');
        if (pausedRef.current) pending.current = next;
        else setReadings(previous => shareReadings(previous, next));
      } catch { setStatus('unavailable'); }
    });
    stream.addEventListener('unavailable', () => setStatus('unavailable'));
    stream.onerror = () => setStatus('reconnecting');
    return () => stream.close();
  }, [endpoint]);
  function togglePause() {
    const next = !pausedRef.current;
    pausedRef.current = next; setPaused(next);
    if (!next && pending.current) { const latest = pending.current; pending.current = null; setReadings(previous => shareReadings(previous, latest)); }
  }
  return { readings, status, paused, togglePause };
}
