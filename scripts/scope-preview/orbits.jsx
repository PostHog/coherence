import { memo, useEffect, useRef } from 'react';
import { useStoreApi } from '@xyflow/react';

// Decoration only. React Flow owns the camera; layout owns the ring radii.
// Never scale a world-sized SVG: WebKit rerasterized that surface for hundreds
// of milliseconds during zoom. The backing store here never exceeds the viewport.
export const OrbitCanvas = memo(function OrbitCanvas({ rings }) {
  const ref = useRef(null), store = useStoreApi();
  useEffect(() => {
    const canvas = ref.current, ctx = canvas.getContext('2d');
    let pending = 0;
    function draw() {
      pending = 0;
      const { width, height, transform: [x, y, zoom] } = store.getState();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(width * dpr), h = Math.round(height * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = '#d9e1ec'; ctx.fillStyle = '#8392a6';
      ctx.lineWidth = 1.2 * zoom; ctx.textAlign = 'center';
      ctx.font = `${10 * zoom}px sans-serif`;
      for (const ring of rings) {
        ctx.setLineDash(ring.disconnected ? [4 * zoom, 7 * zoom] : []);
        ctx.beginPath(); ctx.arc(x, y, ring.radius * zoom, 0, Math.PI * 2); ctx.stroke();
        ctx.fillText(ring.disconnected ? 'UNCONNECTED' : `RELIANCE RING ${ring.ring}`, x, y + (ring.radius + 22) * zoom);
      }
    }
    const schedule = () => { if (!pending) pending = requestAnimationFrame(draw); };
    const unsubscribe = store.subscribe((next, previous) => {
      if (next.transform !== previous.transform || next.width !== previous.width || next.height !== previous.height) schedule();
    });
    window.addEventListener('resize', schedule);
    schedule();
    return () => { unsubscribe(); window.removeEventListener('resize', schedule); cancelAnimationFrame(pending); };
  }, [rings, store]);
  return <canvas ref={ref} className="orbit-canvas" aria-hidden="true"/>;
});
