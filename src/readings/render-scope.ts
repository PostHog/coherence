// render-scope.ts — a self-contained card canvas over the canonical Scope model.
// Opaque cards own their title and text regions. Status occupies a separate badge,
// so evidence decoration cannot obscure the component's name or authored intent.
import type { ScopeGuarantee, ScopeModel, ScopeNode } from "./scope-model.ts";
import { SCOPE_CARD_WIDTH, SCOPE_CARD_HEIGHT } from "./scope-model.ts";

const esc = (value: unknown): string => String(value)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type ScopeLight = "fail" | "stale" | "unknown" | "pass" | "unmeasured";
const LIGHT: Record<ScopeLight, { glyph: string; label: string }> = {
  fail: { glyph: "×", label: "Failing" },
  stale: { glyph: "◷", label: "Stale evidence" },
  unknown: { glyph: "?", label: "Unknown" },
  pass: { glyph: "✓", label: "Passing" },
  unmeasured: { glyph: "—", label: "Unmeasured" },
};

function lightOf(guarantees: ScopeGuarantee[]): ScopeLight {
  if (!guarantees.length) return "unmeasured";
  if (guarantees.some(g => g.verdict === "fail")) return "fail";
  if (guarantees.some(g => g.verdict === "stale")) return "stale";
  if (guarantees.some(g => g.verdict === "unknown")) return "unknown";
  return "pass";
}

const CARD = { width: SCOPE_CARD_WIDTH, height: SCOPE_CARD_HEIGHT };

/** A bounded excerpt; the inspector retains the full original text. */
function linesOf(text: string, width: number, limit: number): string[] {
  const words = text.trim().split(/\s+/).flatMap(word => word.match(new RegExp(`.{1,${width}}`, "gu")) ?? []);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && line.length + word.length + 1 > width) { lines.push(line); line = ""; }
    line += (line ? " " : "") + word;
  }
  if (line) lines.push(line);
  if (lines.length > limit) return [...lines.slice(0, limit - 1), lines[limit - 1].slice(0, width - 1).trimEnd() + "…"];
  return lines;
}

/** Intersect the center-to-center ray with the card perimeter. */
function port(from: ScopeNode, to: { x: number; y: number }): { x: number; y: number } {
  const dx = to.x - from.x, dy = to.y - from.y;
  const scale = 1 / Math.max(Math.abs(dx) / (CARD.width / 2 + 5), Math.abs(dy) / (CARD.height / 2 + 5));
  return Number.isFinite(scale) ? { x: from.x + dx * scale, y: from.y + dy * scale } : { x: from.x, y: from.y };
}

export function renderScope(model: ScopeModel): string {
  const byId = new Map(model.nodes.map(n => [n.id, n]));
  const guaranteesFor = (id: string) => model.guarantees.filter(g => g.component === id);
  const center = byId.get(model.center ?? "") ?? model.nodes[0];
  const orbitGroups = new Map<number, ScopeNode[]>();
  for (const node of model.nodes) if (node.ring > 0) {
    const peers = orbitGroups.get(node.ring) ?? []; peers.push(node); orbitGroups.set(node.ring, peers);
  }
  const orbits = [...orbitGroups].sort(([a], [b]) => a - b).map(([ring, peers]) => ({
    ring, radius: Math.round(Math.hypot(peers[0].x, peers[0].y)), disconnected: peers.every(n => n.disconnected),
  }));
  const extent = Math.max(240, ...orbits.map(r => r.radius + 38),
    ...model.nodes.map(n => Math.abs(n.x) + CARD.width / 2 + 32),
    ...model.nodes.map(n => Math.abs(n.y) + CARD.height / 2 + 32));
  const viewBox = `${-extent} ${-extent} ${extent * 2} ${extent * 2}`;
  const rings = orbits.map(orbit => `<g class="gravity-ring${orbit.disconnected ? " disconnected" : ""}"><circle cx="0" cy="0" r="${orbit.radius}"/><text x="0" y="${-orbit.radius + 18}" text-anchor="middle">${orbit.disconnected ? "UNCONNECTED COMPONENTS" : `RING ${orbit.ring} · ${orbit.ring === 1 ? "DIRECT RELIANCE" : "INDIRECT RELIANCE"}`}</text></g>`).join("");

  // Group only the visual connection; each canonical directed reliance remains in the
  // model and inspector. Opposite arrows become a single two-way path.
  const groups = new Map<string, typeof model.relations>();
  for (const relation of model.relations) {
    const key = JSON.stringify([relation.source, relation.target].sort());
    const members = groups.get(key) ?? []; members.push(relation); groups.set(key, members);
  }
  const connections = [...groups].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, members], index) => ({ members, number: index + 1 }));
  const relations = connections.map(({ members, number }) => {
    const relation = members[0];
    const source = byId.get(relation.source), target = byId.get(relation.target);
    if (!source || !target) return "";
    const naked = members.some(r => r.crossing !== null && r.via === null);
    const mutual = members.some(r => r.source === target.id && r.target === source.id);
    const mid = { x: (source.x + target.x) / 2, y: (source.y + target.y) / 2 };
    const dx = target.x - source.x, dy = target.y - source.y, length = Math.hypot(dx, dy) || 1;
    let control = mid, start = port(source, control), end = port(target, control);
    // Pick the first deterministic bend whose sampled curve clears every other card.
    // This keeps an outer-to-outer dependency from disappearing under the center.
    for (const bend of [0, 160, -160, 320, -320, 480, -480, 640, -640, 880, -880]) {
      control = { x: mid.x - dy / length * bend, y: mid.y + dx / length * bend };
      start = port(source, control); end = port(target, control);
      const blocked = model.nodes.some(n => n !== source && n !== target && Array.from({ length: 41 }, (_, i) => i / 40).some(t => {
        const x = (1-t)**2 * start.x + 2*(1-t)*t*control.x + t*t*end.x;
        const y = (1-t)**2 * start.y + 2*(1-t)*t*control.y + t*t*end.y;
        return Math.abs(x-n.x) < CARD.width/2 + 18 && Math.abs(y-n.y) < CARD.height/2 + 18;
      }));
      if (!blocked) break;
    }
    const labelX = (start.x + 2 * control.x + end.x) / 4;
    const labelY = (start.y + 2 * control.y + end.y) / 4;
    const label = `${number} · ${mutual ? "Mutual reliance" : "Depends on"}`;
    const labelWidth = mutual ? 154 : 132;
    const description = mutual ? `${source.label} and ${target.label} depend on each other` : `${source.label} depends on ${target.label}`;
    return `<g class="relation${naked ? " naked" : ""}" tabindex="0" role="button" aria-label="${esc(description)}" data-connection="${number}" data-source="${esc(source.id)}" data-target="${esc(target.id)}" data-relations="${esc(JSON.stringify(members.map(r => r.id)))}"><title>${esc(description)}</title><path class="connection-line" d="M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}" marker-end="url(#arrow)"${mutual ? ' marker-start="url(#arrow)"' : ""}/><g class="edge-label" transform="translate(${labelX} ${labelY})"><rect x="${-labelWidth/2}" y="-13" width="${labelWidth}" height="26" rx="7"/><text text-anchor="middle" y="4">${label}</text></g></g>`;
  }).join("");

  const cards = model.nodes.map(node => {
    const guarantees = guaranteesFor(node.id), state = lightOf(guarantees), status = LIGHT[state];
    const isCenter = node.id === model.center;
    const titleLines = linesOf(node.label, 25, 2), titleY = titleLines.length === 1 ? 39 : 27;
    const intent = linesOf(node.intent || "No authored description.", 38, 2);
    return `<g class="node ${state}${isCenter ? " center" : ""}" tabindex="0" role="button" aria-label="${esc(node.label)} — ${esc(status.label)}" aria-pressed="${node === center}" data-id="${esc(node.id)}" transform="translate(${node.x - CARD.width / 2} ${node.y - CARD.height / 2})">
      <title>${esc(node.label)} — ${esc(status.label)}</title>
      <rect class="card" width="304" height="184" rx="14"/>
      <path class="title-bar" d="M14 0 H290 Q304 0 304 14 V66 H0 V14 Q0 0 14 0Z"/>
      <path class="divider" d="M0 66 H304"/>
      <text class="card-title" x="18" y="${titleY}">${titleLines.map((line, i) => `<tspan x="18" dy="${i ? 22 : 0}">${esc(line)}</tspan>`).join("")}</text>
      ${isCenter ? '<text class="center-star" x="280" y="38" aria-label="Project center">✦</text>' : ""}
      <text class="card-description" x="18" y="92">${intent.map((line, i) => `<tspan x="18" dy="${i ? 19 : 0}">${esc(line)}</tspan>`).join("")}</text>
      <text class="card-count" x="18" y="137">${node.mass.ownedFiles} files <tspan class="count-separator"> / </tspan>${guarantees.length} guarantees</text>
      <rect class="badge" x="16" y="150" width="${state === "stale" ? 132 : 112}" height="24" rx="6"/>
      <text class="badge-label" x="25" y="166">${status.glyph} ${status.label}</text>
      <text class="card-location" x="286" y="166" text-anchor="end">${isCenter ? "Project center" : "Component"}</text>
    </g>`;
  }).join("");

  const panels = model.nodes.map(node => {
    const guarantees = guaranteesFor(node.id), state = lightOf(guarantees), status = LIGHT[state];
    return `<section class="component-detail" data-id="${esc(node.id)}"${node === center ? "" : " hidden"}>
      <div class="eyebrow">${node.id === model.center ? "Project center" : "Component"}</div>
      <h2>${esc(node.label)}</h2><code class="component-path">${esc(node.id)}</code>
      <p class="detail-intent">${esc(node.intent || "No authored description.")}</p>
      <div class="status-pill ${state}">${status.glyph} ${esc(status.label)}</div>
      <div class="stats"><div><strong>${node.mass.ownedFiles}</strong><span>Files</span></div><div><strong>${guarantees.length}</strong><span>Guarantees</span></div><div><strong>${node.mass.total}</strong><span>Mass</span></div></div>
      <details class="mass-detail"><summary>What gives this component gravity?</summary><dl><dt>Owned surface</dt><dd>${node.mass.ownedSurface}</dd><dt>Inbound reliance</dt><dd>${node.mass.inboundReliance}</dd><dt>Boundary authority</dt><dd>${node.mass.boundaryAuthority}</dd><dt>Guarantee responsibility</dt><dd>${node.mass.guaranteeResponsibility}</dd></dl></details>
      <h3>Guarantees <span>${guarantees.length}</span></h3>
      ${guarantees.length ? `<ul class="guarantees">${guarantees.map(g => `<li><div class="guarantee-state ${g.verdict}">${LIGHT[g.verdict].glyph} ${esc(LIGHT[g.verdict].label)} <span>Grade ${g.grade}</span></div><p>${esc(g.invariant)}</p><details><summary>Evidence</summary><dl><dt>Boundary</dt><dd>${esc(g.chokepoint)}</dd><dt>Oracle</dt><dd>${esc(g.oracle || "No oracle")}</dd></dl></details></li>`).join("")}</ul>` : '<p class="no-guarantees">No boundary guarantees are recorded for this component. This is unmeasured, not a passing result.</p>'}
    </section>`;
  }).join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(model.root)} — Scope</title>
<style>
:root{color-scheme:light;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#253247;background:#f6f7fa;font-synthesis:none}
*{box-sizing:border-box}body{margin:0;height:100vh;display:grid;grid-template-rows:76px minmax(0,1fr)}button{font:inherit;cursor:pointer}button:focus-visible,summary:focus-visible{outline:3px solid #6a7de4;outline-offset:3px}
header{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:0 28px;border-bottom:1px solid #e1e5ed;background:#fff}.brand{display:flex;align-items:center;gap:13px}.brand-icon{width:32px;height:32px;background:#edf0ff;color:#596ac0;display:grid;place-items:center;border-radius:10px;font-size:23px}h1{margin:0;font-size:19px;letter-spacing:-.5px}.project-name{padding-left:15px;border-left:1px solid #dce1ea;font-size:14px;color:#66738a}.summary{color:#66738a;font-size:13px;display:flex;gap:20px}.summary b{font-weight:600;color:#26354b}
main{display:grid;grid-template-columns:minmax(0,1fr) 330px;min-height:0}.viewport{position:relative;overflow:hidden;touch-action:none;background-color:#f6f7fa;background-image:radial-gradient(#d8dfeb .7px,transparent .7px);background-size:20px 20px}.viewport>svg{width:100%;height:100%;display:block;cursor:grab}.viewport.dragging>svg{cursor:grabbing}.canvas-label{position:absolute;top:22px;left:26px;font-size:11px;letter-spacing:1.5px;font-weight:650;color:#78849a;pointer-events:none}.controls{position:absolute;bottom:22px;left:24px;display:flex;align-items:center;gap:5px;background:#fff;border:1px solid #e0e5ee;padding:5px;border-radius:12px;box-shadow:0 3px 12px #23345108}.controls button{border:0;border-radius:7px;background:transparent;color:#44526a;min-width:32px;height:32px;font-size:18px}.controls button:hover{background:#edf1f8}.controls #home{font-size:12px;padding:0 10px}.controls output{min-width:42px;text-align:center;color:#6d7a90;font-size:11px}.canvas-hint{position:absolute;right:22px;bottom:31px;color:#78849a;font-size:11px;pointer-events:none}
.relation path{fill:none;stroke:#b2bdd0;stroke-width:1.5}.relation.naked path{stroke:#aa7034;stroke-dasharray:5 4}.relation.active path{stroke:#7184d3;stroke-width:2}.node{cursor:pointer;outline:none}.card{fill:#fff;stroke:#d5dde9;stroke-width:1;filter:drop-shadow(0px 3px 5px #24364b0c)}.title-bar{fill:#f1f4f9}.divider{fill:none;stroke:#e1e6ef;stroke-width:1}.node.center .title-bar{fill:#edf0ff}.node.center .card{stroke:#a8b5e4}.node.selected .card,.node:focus-visible .card{stroke:#778bd5;stroke-width:2}.node:hover .card{stroke:#9aaacc}
svg text{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;fill:#253247;pointer-events:none}.card-title{font-size:18px;font-weight:650;letter-spacing:-.3px}.center-star{fill:#7485c8;font-size:18px}.card-description{font-size:13px;fill:#5d6b82}.card-count{font-size:12px;fill:#4d5d76}.count-separator{fill:#b0bac9}.badge{fill:#f0f3f7}.badge-label{font-size:11px;font-weight:600;fill:#5d6b82}.card-location{font-size:10px;fill:#78859a}.node.stale .badge{fill:#fff3de}.node.stale .badge-label{fill:#865e1f}.node.fail .badge{fill:#fcebed}.node.fail .badge-label{fill:#a24050}.node.pass .badge{fill:#eaf5ef}.node.pass .badge-label{fill:#306b4c}
aside{background:#fff;border-left:1px solid #e1e5ed;overflow-y:auto;padding:28px 24px}.eyebrow{font-size:10px;font-weight:650;letter-spacing:1.5px;text-transform:uppercase;color:#7885a1}h2{margin:10px 0 7px;font-size:23px;line-height:1.25;letter-spacing:-.6px;overflow-wrap:anywhere}.component-path{font-size:11px;color:#8690a2}.detail-intent{font-size:13px;line-height:1.7;color:#63718a;margin:22px 0 16px}.status-pill{display:inline-block;font-size:11px;font-weight:600;border-radius:6px;background:#f0f3f7;color:#596981;padding:5px 9px}.status-pill.stale{background:#fff3de;color:#865e1f}.status-pill.fail{background:#fcebed;color:#a24050}.status-pill.pass{background:#eaf5ef;color:#306b4c}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:25px 0;padding:18px 0;border-top:1px solid #edf0f5;border-bottom:1px solid #edf0f5}.stats strong{font-size:22px;font-weight:600;display:block}.stats span{font-size:11px;color:#8490a3;display:block;margin-top:5px}summary{cursor:pointer;font-size:11px;color:#6e7d94;line-height:1.6}dl{display:grid;grid-template-columns:1fr auto;gap:8px;font-size:11px;color:#718099}dt,dd{margin:0;overflow-wrap:anywhere}dd{color:#334561}h3{display:flex;justify-content:space-between;align-items:center;margin:28px 0 15px;font-size:13px;font-weight:600}h3 span{color:#8591a4;font-weight:400}.guarantees{padding:0;margin:0;list-style:none}.guarantees li{padding:16px 0;border-top:1px solid #edf0f5}.guarantee-state{font-size:10px;color:#718099;display:flex;justify-content:space-between}.guarantee-state.stale{color:#94692b}.guarantee-state.fail{color:#a24050}.guarantee-state.pass{color:#306b4c}.guarantee-state span{color:#8b96a7}.guarantees p{font-size:12px;line-height:1.6;margin:9px 0;color:#3c4b63}.guarantees dl{display:block}.guarantees dd{margin:3px 0 12px}.no-guarantees{font-size:12px;line-height:1.7;color:#768398;background:#f7f8fb;padding:14px;border-radius:9px}.legend{font-size:11px;color:#78859a;padding-top:24px;border-top:1px solid #edf0f5;margin-top:25px;line-height:1.9}.empty{position:absolute;inset:0;display:grid;place-content:center;text-align:center;color:#768398;font-size:14px;pointer-events:none}.empty b{font-size:12px;letter-spacing:1px}
@media(max-width:850px){main{grid-template-columns:minmax(0,1fr) 280px}aside{padding:22px 18px}.summary{gap:10px}.canvas-hint{display:none}}
@media(max-width:620px){body{height:auto;min-height:100vh}header{padding:16px;height:auto;flex-wrap:wrap}.summary{display:none}main{display:flex;flex-direction:column}.viewport{height:72vh;min-height:480px}aside{border-left:0;border-top:1px solid #e1e5ed}.canvas-label{top:16px;left:16px}}
@media print{body{height:auto;display:block}header{height:70px}.controls,.canvas-hint{display:none}main{display:block}.viewport{height:75vh;background:white}aside{border:0}.card{filter:none;stroke:#666}.card-title{fill:#172236}.badge{fill:#eee!important}.badge-label{fill:#333!important}}
</style></head><body>
<header><div class="brand"><span class="brand-icon" aria-hidden="true">⌘</span><h1>Scope</h1><span class="project-name">${esc(model.root)}</span></div><div class="summary"><span><b>${model.nodes.length}</b> components</span><span><b>${model.relations.length}</b> connections</span><span><b>${model.guarantees.length}</b> guarantees</span></div></header>
<main><div class="viewport" id="viewport"><div class="canvas-label">PROJECT MAP</div>${model.nodes.length ? "" : '<div class="empty"><b>NO COMPONENTS</b><p>The model contains no component subjects.</p></div>'}
<svg id="canvas" viewBox="${viewBox}" role="img" aria-label="Project scope centered on ${esc(center?.label ?? "no component")}"><defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7" fill="none" stroke="#95a4bc" stroke-width="1.2"/></marker></defs><g id="scene">${relations}${cards}</g></svg>
<div class="controls" aria-label="Canvas controls"><button id="zoom-out" aria-label="Zoom out">−</button><output id="zoom">100%</output><button id="zoom-in" aria-label="Zoom in">+</button><button id="home">Fit to view</button></div><span class="canvas-hint">Drag to pan · Scroll to zoom · Select to inspect</span></div>
<aside aria-label="Component inspector">${panels || '<h2>Nothing to inspect</h2>'}<div class="legend">✦ Project center of gravity<br>unmeasured — no guarantees<br>Dashed connection: unguarded crossing</div></aside></main>
<script>(()=>{
const viewport=document.getElementById("viewport"),svg=document.getElementById("canvas"),output=document.getElementById("zoom");
const initial=svg.getAttribute("viewBox").split(" ").map(Number);let box=initial.slice(),drag=null;
const draw=()=>{svg.setAttribute("viewBox",box.join(" "));output.textContent=Math.round(initial[2]/box[2]*100)+"%"};
const point=e=>{const p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;return p.matrixTransform(svg.getScreenCTM().inverse())};
const select=n=>{document.querySelectorAll(".node").forEach(item=>{const active=item===n;item.classList.toggle("selected",active);item.setAttribute("aria-pressed",String(active))});document.querySelectorAll(".component-detail").forEach(panel=>panel.hidden=panel.dataset.id!==n.dataset.id);document.querySelectorAll(".relation").forEach(edge=>edge.classList.toggle("active",edge.dataset.source===n.dataset.id||edge.dataset.target===n.dataset.id))};
document.querySelectorAll(".node").forEach(n=>{n.addEventListener("click",()=>select(n));n.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();select(n)}})});
const selected=document.querySelector('.node[aria-pressed="true"]');if(selected)select(selected);
svg.addEventListener("pointerdown",e=>{if(e.button!==0||e.target.closest(".node"))return;drag=point(e);svg.setPointerCapture(e.pointerId);viewport.classList.add("dragging")});
svg.addEventListener("pointermove",e=>{if(!drag)return;const p=point(e);box[0]+=drag.x-p.x;box[1]+=drag.y-p.y;draw()});
const release=()=>{drag=null;viewport.classList.remove("dragging")};svg.addEventListener("pointerup",release);svg.addEventListener("pointercancel",release);
const zoom=(factor,p)=>{const next=box[2]*factor;if(next<initial[2]*.2||next>initial[2]*3)return;box=[p.x+(box[0]-p.x)*factor,p.y+(box[1]-p.y)*factor,next,box[3]*factor];draw()};
svg.addEventListener("wheel",e=>{e.preventDefault();zoom(e.deltaY<0?.9:1.1,point(e))},{passive:false});
document.getElementById("zoom-in").onclick=()=>zoom(.85,{x:box[0]+box[2]/2,y:box[1]+box[3]/2});document.getElementById("zoom-out").onclick=()=>zoom(1/.85,{x:box[0]+box[2]/2,y:box[1]+box[3]/2});
document.getElementById("home").onclick=()=>{box=initial.slice();draw()};
})();</script></body></html>`;
}
