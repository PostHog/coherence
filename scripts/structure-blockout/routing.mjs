const STEP = 10;
const LEAD = 36, CLEARANCE = 12;
export const intersects = (a, b, gap = 0) => a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
const inside = (p, r, pad = 0) => p.x > r.x - pad && p.x < r.x + r.width + pad && p.y > r.y - pad && p.y < r.y + r.height + pad;
const center = r => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export function wrap(text, width, font = '18px system-ui', letterSpacing = 0) {
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
  ctx.font = font;
  const lines = [''];
  for (const word of text.split(/\s+/)) {
    const i = lines.length - 1, next = lines[i] ? `${lines[i]} ${word}` : word;
    if (ctx.measureText(next).width + next.length * letterSpacing > width && lines[i]) lines.push(word); else lines[i] = next;
  }
  return lines;
}

function ports(r, used) {
  const c = center(r);
  c.x = Math.round(c.x / STEP) * STEP; c.y = Math.round(c.y / STEP) * STEP;
  return [
    { x: r.x, y: c.y, side: 'left', dx: -1, dy: 0 },
    { x: r.x + r.width, y: c.y, side: 'right', dx: 1, dy: 0 },
    { x: c.x, y: r.y, side: 'top', dx: 0, dy: -1 },
    { x: c.x, y: r.y + r.height, side: 'bottom', dx: 0, dy: 1 },
  ].map(p=> {
    // Separate arrivals on a shared face. Keep them on the same routing lattice
    // and away from rounded card corners; labels retain one continuous axis.
    if(used && !r.edge) {
      const offset=[0,-30,30,-60,60].find(v=> {
        const x=p.x+(p.dy?v:0),y=p.y+(p.dx?v:0);
        return (p.dy?x>r.x+24&&x<r.x+r.width-24:y>r.y+24&&y<r.y+r.height-24) &&
          !used.get(`${Math.round(x/STEP)*STEP},${Math.round(y/STEP)*STEP}`);
      }) ?? 0;
      p.x+=p.dy?offset:0; p.y+=p.dx?offset:0;
    }
    return {...p,lead:r.edge?20:LEAD};
  });
}

class Heap {
  values = [];
  push(v) { let i = this.values.length; this.values.push(v); while (i) { const p = (i - 1) >> 1; if (this.values[p].f <= v.f) break; this.values[i] = this.values[p]; i = p; } this.values[i] = v; }
  pop() { const first = this.values[0], last = this.values.pop(); if (this.values.length) { let i = 0; while (i * 2 + 1 < this.values.length) { let c = i * 2 + 1; if (c + 1 < this.values.length && this.values[c + 1].f < this.values[c].f) c++; if (this.values[c].f >= last.f) break; this.values[i] = this.values[c]; i = c; } this.values[i] = last; } return first; }
}

function gridPath(start, end, obstacles, used, bounds) {
  const snap = p => ({ x: (p.dx > 0 ? Math.ceil : p.dx < 0 ? Math.floor : Math.round)((p.x + p.dx * p.lead) / STEP) * STEP, y: (p.dy > 0 ? Math.ceil : p.dy < 0 ? Math.floor : Math.round)((p.y + p.dy * p.lead) / STEP) * STEP });
  const a = snap(start), b = snap(end);
  if (obstacles.some(r => inside(a, r, CLEARANCE) || inside(b, r, CLEARANCE))) return null;
  const key = (x, y, d) => `${x},${y},${d}`;
  const heap = new Heap(), seen = new Map();
  const origin = { ...a, d: start.dx > 0 ? 0 : start.dy > 0 ? 1 : start.dx < 0 ? 2 : 3, g: 0, f: distance(a, b), parent: null };
  heap.push(origin);
  let iterations = 0;
  while (heap.values.length && ++iterations < 100000) {
    const n = heap.pop();
    if (n.x === b.x && n.y === b.y) {
      const result = []; for (let at = n; at; at = at.parent) result.unshift({ x: at.x, y: at.y });
      return simplify([start, ...result, end]);
    }
    for (const [d, dx, dy] of [[0, STEP, 0], [1, 0, STEP], [2, -STEP, 0], [3, 0, -STEP]]) {
      if (d === (n.d + 2) % 4) continue;
      const x = n.x + dx, y = n.y + dy;
      if (x === b.x && y === b.y && dx*end.dx + dy*end.dy > 0) continue;
      if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY || obstacles.some(r => inside({ x, y }, r, CLEARANCE))) continue;
      const g = n.g + STEP + (d !== n.d ? 28 : 0) + (used.get(`${x},${y}`) ?? 0) * 28;
      const k = key(x, y, d); if ((seen.get(k) ?? Infinity) <= g) continue;
      seen.set(k, g); heap.push({ x, y, d, g, f: g + distance({ x, y }, b), parent: n });
    }
  }
  return null;
}

// Geometry has one spelling: simplified waypoints generate both the visible path
// and diagnostic points. Collinear grid samples never become tiny visual bends.
function simplify(points) {
  const result = [];
  for (const p of points) {
    if (result.length && distance(result.at(-1), p) < 0.001) continue;
    while (result.length > 1) {
      const a = result.at(-2), b = result.at(-1);
      const u = { x: b.x-a.x, y: b.y-a.y }, v = { x: p.x-b.x, y: p.y-b.y };
      if (Math.abs(u.x*v.y-u.y*v.x) > 0.001) break;
      result.pop();
    }
    result.push(p);
  }
  return result;
}

function curvedPath(points, obstacles) {
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length-1; i++) {
    const a = points[i-1], b = points[i], c = points[i+1];
    const incoming = Math.hypot(b.x-a.x,b.y-a.y), outgoing = Math.hypot(c.x-b.x,c.y-b.y);
    const u = { x:(b.x-a.x)/incoming, y:(b.y-a.y)/incoming };
    const v = { x:(c.x-b.x)/outgoing, y:(c.y-b.y)/outgoing };
    // Retain at least 28 units of straight shaft beside a card/arrowhead.
    let radius = Math.max(0, Math.min(32, incoming/2, outgoing/2,
      i === 1 ? incoming-Math.min(28,points[0].lead-8) : Infinity, i === points.length-2 ? outgoing-Math.min(28,points.at(-1).lead-8) : Infinity));
    let bend;
    while (radius >= 1) {
      const start = { x:b.x-u.x*radius, y:b.y-u.y*radius };
      const end = { x:b.x+v.x*radius, y:b.y+v.y*radius };
      const k = 0.55228475*radius;
      const p1 = { x:start.x+u.x*k, y:start.y+u.y*k };
      const p2 = { x:end.x-v.x*k, y:end.y-v.y*k };
      let clear = true;
      for (let j=0;j<=32;j++) {
        const t=j/32,q=1-t;
        const p={x:q*q*q*start.x+3*q*q*t*p1.x+3*q*t*t*p2.x+t*t*t*end.x,
          y:q*q*q*start.y+3*q*q*t*p1.y+3*q*t*t*p2.y+t*t*t*end.y};
        if(obstacles.some(r=>inside(p,r,8))) { clear=false; break; }
      }
      if(clear) { bend=`L ${start.x} ${start.y} C ${p1.x} ${p1.y} ${p2.x} ${p2.y} ${end.x} ${end.y}`; break; }
      radius /= 2;
    }
    path += ` ${bend ?? `L ${b.x} ${b.y}`}`;
  }
  const end=points.at(-1);
  return `${path} L ${end.x} ${end.y}`;
}

function smoothConnection(points, obstacles, source, target) {
  const s=points[0],t=points.at(-1);
  const a={x:s.x+s.dx*s.lead,y:s.y+s.dy*s.lead},b={x:t.x+t.dx*t.lead,y:t.y+t.dy*t.lead};
  const span=Math.hypot(a.x-b.x,a.y-b.y);
  const facing=s.dx===-t.dx&&s.dy===-t.dy;
  const forward=(b.x-a.x)*s.dx+(b.y-a.y)*s.dy;
  // Facing handles must stay ordered along the direction of travel. A fixed
  // minimum reach folded short clear wires back on themselves. If the reserved
  // leads already overlap, retain the obstacle router's corridor instead.
  if(facing&&forward<=0) return curvedPath(points,obstacles);
  for(const scale of [0.45,0.25,0.7]) {
    const reach=Math.min(Math.max(32,span*scale),facing?forward/3:Infinity);
    const c1={x:a.x+s.dx*reach,y:a.y+s.dy*reach};
    const c2={x:b.x+t.dx*reach,y:b.y+t.dy*reach};
    const samples=Math.ceil((distance(a,c1)+distance(c1,c2)+distance(c2,b))/2);
    let clear=true;
    for(let j=0;j<=samples;j++) {
      const v=j/samples,q=1-v,p={x:q*q*q*a.x+3*q*q*v*c1.x+3*q*v*v*c2.x+v*v*v*b.x,
        y:q*q*q*a.y+3*q*q*v*c1.y+3*q*v*v*c2.y+v*v*v*b.y};
      if(obstacles.some(r=>inside(p,r,8))) {clear=false;break;}
    }
    // Leads are sampled too: a clear central curve cannot redeem a shaft that
    // crosses a neighboring object. The endpoint's own border is intentional.
    for(const [u,v,owner] of [[s,a,source],[b,t,target]]) for(let j=1;j<LEAD;j++) {
      const p={x:u.x+(v.x-u.x)*j/LEAD,y:u.y+(v.y-u.y)*j/LEAD};
      if(obstacles.some(r=>inside(p,r,r===owner?0:8))) clear=false;
    }
    if(clear) return `M ${s.x} ${s.y} L ${a.x} ${a.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y} L ${t.x} ${t.y}`;
  }
  return curvedPath(points,obstacles);
}

function connect(a, b, obstacles, used, bounds, forcedTarget, forcedSource) {
  const sourcePorts=forcedSource?[forcedSource]:ports(a,used);
  // A nearby label should not force a decorative jog. Its arrival stays fixed;
  // offer an aligned free point on the component border before routing.
  if(!forcedSource&&!a.edge&&b.edge&&forcedTarget) {
    for(const s of [...sourcePorts]) {
      const t=forcedTarget;
      if(s.dx!==-t.dx||s.dy!==-t.dy) continue;
      const aligned={...s,x:s.dy?t.x:s.x,y:s.dx?t.y:s.y};
      const inset=s.dy?aligned.x-a.x:aligned.y-a.y,size=s.dy?a.width:a.height;
      if(distance(s,aligned)>0&&distance(s,aligned)<=STEP&&inset>24&&inset<size-24&&
        !used.get(`${Math.round(aligned.x/STEP)*STEP},${Math.round(aligned.y/STEP)*STEP}`)) sourcePorts.push(aligned);
    }
  }
  const pairs = sourcePorts.flatMap(s => (forcedTarget ? [forcedTarget] : ports(b, used)).map(t => ({ s, t, distance: distance(s, t) + 2*Math.max(0,-((center(b).x-s.x)*s.dx+(center(b).y-s.y)*s.dy)) + 2*Math.max(0,-((center(a).x-t.x)*t.dx+(center(a).y-t.y)*t.dy)) })))
    .sort((a, b) => a.distance - b.distance);
  for (const { s, t } of pairs) {
    const path = gridPath(s, t, obstacles, used, bounds);
    if (path) return path;
  }
  return null;
}

export function route(cards, relationships, annotations = [], fixedLabels) {
  const byId = Object.fromEntries(cards.map(c => [c.id, c]));
  const boxes = [...cards, ...annotations];
  const bounds = { minX: Math.min(...boxes.map(c => c.x)) - 260, maxX: Math.max(...boxes.map(c => c.x + c.width)) + 260,
    minY: Math.min(...boxes.map(c => c.y)) - 140, maxY: Math.max(...boxes.map(c => c.y + c.height)) + 200 };
  const labels = fixedLabels ? fixedLabels.filter(l=>relationships.some(e=>e.id===l.id)).map(l=>({...l,edge:relationships.find(e=>e.id===l.id)})) : [];
  if(fixedLabels) boxes.push(...fixedLabels);
  // Short links get the scarce nearby label slots before flexible longer links.
  const length = e => distance(center(byId[e.source]), center(byId[e.target]));
  const ordered = [...relationships].sort((a, b) => (b.priority??0)-(a.priority??0) || length(a) - length(b) || a.id.localeCompare(b.id));
  // Reserve destination interfaces before a label can pull the wire to the
  // wrong side of its target. Occupied faces share load through distinct ports.
  const approaches=new Map(), reserved=new Map(), faces=new Map(), corridors=[];
  for(const edge of ordered.filter(e=>e.kind==='architecture'||e.targetPort)) {
    const source=byId[edge.source],target=byId[edge.target],origin=center(source);
    const pinned=fixedLabels?.find(l=>l.id===edge.id)?.targetPort??edge.targetPort;
    const candidates=(pinned?[pinned]:ports(target,reserved)).map(p=>({p,
      cost:distance(origin,p)+4*Math.max(0,-((origin.x-p.x)*p.dx+(origin.y-p.y)*p.dy))+
        (faces.get(`${target.id}:${p.side}`)??0)*100})).sort((a,b)=>a.cost-b.cost);
    const chosen=candidates.find(({p})=> {
      for(let d=1;d<=p.lead;d+=2) {
        const at={x:p.x+p.dx*d,y:p.y+p.dy*d};
        if(boxes.some(b=>b.id!==target.id&&inside(at,b,CLEARANCE))) return false;
      }
      return true;
    })?.p;
    if(!chosen) throw new Error(`No clear destination approach for ${edge.label}`);
    approaches.set(edge.id,chosen);
    reserved.set(`${Math.round(chosen.x/STEP)*STEP},${Math.round(chosen.y/STEP)*STEP}`,1);
    faces.set(`${target.id}:${chosen.side}`,(faces.get(`${target.id}:${chosen.side}`)??0)+1);
    const tip={x:chosen.x+chosen.dx*80,y:chosen.y+chosen.dy*80};
    corridors.push({id:edge.id,x:Math.min(chosen.x,tip.x)-16,y:Math.min(chosen.y,tip.y)-16,
      width:Math.abs(chosen.x-tip.x)+32,height:Math.abs(chosen.y-tip.y)+32});
  }
  for (const edge of fixedLabels ? [] : ordered) {
    const source = byId[edge.source], target = byId[edge.target];
    if (!source || !target) continue;
    if (edge.kind !== 'architecture') continue;
    const text = edge.kind === 'guarantee-reliance' ? 'Relies on this promise' : edge.label;
    const lines = wrap(text, 174), width = 198, height = lines.length * 23 + 16;
    const a = center(source), b = center(target), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const approach=approaches.get(edge.id),dx=b.x-a.x,dy=b.y-a.y,span=Math.hypot(dx,dy)||1;
    let best;
    for (let y = bounds.minY + 60; y < bounds.maxY - 60; y += 10) for (let x = bounds.minX + 120; x < bounds.maxX - 120; x += 10) {
      const rect = { x: x - width / 2, y: y - height / 2, width, height };
      if (boxes.some(r => intersects(rect, r, 48)) || corridors.some(r=>intersects(rect,r,8))) continue;
      const progress=((x-a.x)*dx+(y-a.y)*dy)/span;
      const overshoot=Math.max(0,-progress,progress-span);
      const away=Math.max(0,-((x-approach.x)*approach.dx+(y-approach.y)*approach.dy));
      const score = distance(a, { x, y }) + distance({ x, y }, approach) + distance(mid, { x, y }) * 0.55 + overshoot*8 + away*4;
      if (!best || score < best.score) best = { ...rect, score };
    }
    if (!best) throw new Error(`No label space for ${edge.label}`);
    const label = { ...best, id: edge.id, lines, edge, targetPort:approach };
    labels.push(label); boxes.push(label);
  }
  const used = new Map(reserved), result = [];
  for (const label of labels) {
    const edge = label.edge, source = byId[edge.source], target = byId[edge.target];
    const obstacles = boxes;
    let first, second;
    const labelPorts=ports(label), targetPort=label.targetPort??edge.targetPort;
    const passageCost=arrival=> {
      const departure=labelPorts.find(p=>p.dx===-arrival.dx&&p.dy===-arrival.dy);
      const from=center(source),to=targetPort??center(target);
      return distance(from,arrival)+distance(departure,to)+
        4*Math.max(0,-((from.x-arrival.x)*arrival.dx+(from.y-arrival.y)*arrival.dy))+
        4*Math.max(0,-((to.x-departure.x)*departure.dx+(to.y-departure.y)*departure.dy));
    };
    const arrivals = label.arrival ? [label.arrival] : labelPorts.sort((a,b)=>passageCost(a)-passageCost(b));
    for (const arrival of arrivals) {
      const departure = ports(label).find(p => p.dx === -arrival.dx && p.dy === -arrival.dy);
      first = connect(source, label, obstacles, used, bounds, arrival);
      if (!first) continue;
      second = connect(label, target, obstacles, used, bounds, label.targetPort??edge.targetPort, departure);
      if (second) break;
    }
    if (!first || !second) throw new Error(`No obstacle-free route for ${edge.label}`);
    const points = simplify([...first, ...second]);
    for (let i=1;i<points.length;i++) {
      const a=points[i-1],b=points[i],steps=Math.ceil(distance(a,b)/STEP);
      for(let j=0;j<=steps;j++) {
        const k=`${Math.round((a.x+(b.x-a.x)*j/steps)/STEP)*STEP},${Math.round((a.y+(b.y-a.y)*j/steps)/STEP)*STEP}`;
        used.set(k,(used.get(k)??0)+1);
      }
    }
    const sourcePath=smoothConnection(first,boxes,source,label);
    const bridge=` L ${second[0].x} ${second[0].y} `;
    const targetPath=smoothConnection(second,boxes,label,target);
    label.sourcePath=sourcePath; label.arrival=first.at(-1);
    const prefix=sourcePath+bridge;
    result.push({...edge,labelBox:label,points,prefix,targetPath,
      path:prefix+targetPath.replace(/^M [^ ]+ [^ ]+ /,'')});
  }
  for (const edge of ordered.filter(e => e.kind !== 'architecture')) {
    const points = connect(byId[edge.source], byId[edge.target], boxes, used, bounds, edge.targetPort);
    if (!points) throw new Error(`No direct route for ${edge.label}`);
    result.push({ ...edge, points, path: smoothConnection(points, boxes, byId[edge.source], byId[edge.target]) });
  }
  return result;
}
