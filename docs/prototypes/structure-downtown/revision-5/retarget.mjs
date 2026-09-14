const DURATION = 700;
const tailCommands = path => path.replace(/^M [^ ]+ [^ ]+ /, '');

function trace(path, fraction) {
  const svg=document.createElementNS('http://www.w3.org/2000/svg','path');
  svg.setAttribute('d',path);
  const length=svg.getTotalLength()*Math.max(0.001,fraction),steps=Math.max(1,Math.ceil(length/2));
  return Array.from({length:steps+1},(_,i)=> {
    const p=svg.getPointAtLength(length*i/steps);
    return `${i?'L':'M'} ${p.x} ${p.y}`;
  }).join(' ');
}

// One relationship keeps one DOM path and one arrowhead. Only its downstream
// geometry changes; the label and upstream connection remain architectural anchors.
export function animateReliance(ref, line, halo, edge, tile) {
  const previous = ref.current;
  const state = { target: edge.target, tail: edge.targetPath, tile, moving: false };
  ref.current = state;
  const draw = path => {
    line.setAttribute('d', path);
    halo.setAttribute('d', path);
  };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const finish = () => {
    state.tail = edge.targetPath;
    state.moving = false;
    draw(edge.path);
    line.removeAttribute('data-retargeting');
    line.removeAttribute('data-retarget-progress');
  };
  if (edge.kind !== 'guarantee-reliance' || !previous?.tail || !edge.targetPath ||
      tile || previous.tile || reduced.matches ||
      (previous.target === edge.target && !previous.moving)) {
    finish();
    return;
  }
  // Sample the currently displayed tail on interruption, not its abandoned goal.
  const from = previous.tail, to = edge.targetPath;
  let frame;
  const start = performance.now();
  state.moving = true;
  state.tail = previous.tail;
  draw(edge.prefix + tailCommands(state.tail));
  line.setAttribute('data-retargeting', 'true');
  line.setAttribute('data-retarget-progress', '0');
  const tick = now => {
    const t = Math.min(1, (now - start) / DURATION);
    if (t === 1 || reduced.matches) { finish(); return; }
    const phase=t<0.5?t*2:(t-0.5)*2;
    const ease=phase*phase*(3-2*phase);
    state.tail=t<0.5?trace(from,1-ease):trace(to,ease);
    draw(edge.prefix + tailCommands(state.tail));
    line.setAttribute('data-retarget-progress', String(t));
    frame = requestAnimationFrame(tick);
  };
  const preferenceChanged = () => { if (reduced.matches) { cancelAnimationFrame(frame); finish(); } };
  reduced.addEventListener('change', preferenceChanged);
  frame = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(frame);
    reduced.removeEventListener('change', preferenceChanged);
  };
}
