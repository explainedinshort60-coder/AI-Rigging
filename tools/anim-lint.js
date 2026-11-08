#!/usr/bin/env node
/*
 * anim-lint: checks an AI Rigging project against the 12 principles, anatomy and pose rules.
 *
 *   node tools/anim-lint.js project.rig.json [--json] [--from 1 --to 72]
 *
 * It evaluates every frame with the real engine, then flags problems with frame numbers.
 * Thresholds are starting points (marked convention or proposed in docs/animation-knowledge),
 * not laws: a style can break any of them on purpose. Tags: [MUST] blocks approval,
 * [SHOULD] clearly better, [COULD] polish.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const RK = require(path.join(__dirname, '..', 'src', 'engine.js'));

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
if (!file) { console.error('usage: node tools/anim-lint.js project.rig.json [--json] [--from N --to N]'); process.exit(2); }
const P = JSON.parse(fs.readFileSync(file, 'utf8'));
const opt = k => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : null; };
const F0 = +(opt('from') || 1), F1 = +(opt('to') || P.frames);
const asJSON = args.includes('--json');

const notes = [];
const note = (sev, rule, frames, msg, fix) => notes.push({ sev, rule, frames, msg, fix });
const byId = {}; P.bones.forEach(b => byId[b.id] = b);
const kids = id => P.bones.filter(b => b.parent === id);
const label = id => (byId[id] && byId[id].name) || id;
const fr = (a, b) => (a === b ? `F${a}` : `F${a}-${b}`);

/* ---------- sample every frame (no dynamics: we judge the keyed performance) ---------- */
const poses = {};
for (let f = F0; f <= F1; f++) poses[f] = RK.evaluate(P, f, {});
const rest = RK.evaluate(P, 0, {});
const height = (() => { // character height from rest bone extents
  let y0 = Infinity, y1 = -Infinity;
  for (const b of P.bones) { const w = rest.world[b.id]; for (const t of [0, b.length || 0]) { const p = RK.M.apply(w, t, 0); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); } }
  return Math.max(50, y1 - y0);
})();
const worldAngle = (pose, id) => RK.M.angle(pose.world[id]);
const tip = (pose, id) => RK.M.apply(pose.world[id], byId[id].length || 0, 0);
const base = (pose, id) => RK.M.apply(pose.world[id], 0, 0);
const tracks = (P.anim && P.anim.bones) || {};

/* ---------- 1. eases: linear and one-size-fits-all (slow in / slow out) ---------- */
{
  let total = 0, linear = [], easeCount = {};
  for (const id in tracks) for (const ch in tracks[id]) {
    const ks = tracks[id][ch];
    for (let i = 0; i < ks.length - 1; i++) {
      if (ks[i][1] === ks[i + 1][1]) continue; // hold, ease irrelevant
      const e = Array.isArray(ks[i][2]) ? 'bezier' : (ks[i][2] || 'smooth');
      if (e === 'step') continue;
      total++; easeCount[e] = (easeCount[e] || 0) + 1;
      // a linear segment is only robotic when it is a whole move (starts and ends at a hold or a reversal);
      // linear pass-through segments inside an eased move are a normal spacing tool
      const dir = Math.sign(ks[i + 1][1] - ks[i][1]);
      const startsMove = i === 0 || Math.sign(ks[i][1] - ks[i - 1][1]) !== dir;
      const endsMove = i + 2 >= ks.length || Math.sign(ks[i + 2][1] - ks[i + 1][1]) !== dir;
      if (e === 'linear' && startsMove && endsMove && !/^(eyes|brows|mouth)/.test(id)) linear.push(`${label(id)}.${ch} F${ks[i][0]}`);
    }
  }
  if (linear.length) note('SHOULD', 'Slow in / slow out', null, `${linear.length} organic move(s) use linear spacing (constant speed, robotic): ${linear.slice(0, 6).join(', ')}${linear.length > 6 ? ' ...' : ''}`, 'Use an ease that matches the intent: fast-out for snaps, ease-in or smooth for settles.');
  const top = Object.entries(easeCount).sort((a, b) => b[1] - a[1])[0];
  if (total >= 8 && top && top[1] / total > 0.8) note('SHOULD', 'Slow in / slow out', null, `${Math.round(top[1] / total * 100)}% of moves use the same ease ("${top[0]}"). Equal cushioning everywhere reads soft and floaty.`, 'Make eases asymmetric and purposeful: fast-out after anticipations, long settles into holds, overshoot into accents.');
}

/* ---------- 2. overlap: parent and child keyed on identical frames ---------- */
for (const b of P.bones) {
  if (!b.parent || !tracks[b.id] || !tracks[b.parent]) continue;
  const kf = id => new Set(Object.values(tracks[id]).flat().map(k => k[0]).filter(f => f > F0 && f < F1));
  const a = kf(b.parent), c = kf(b.id);
  if (a.size < 3 || c.size < 3) continue;
  const shared = [...c].filter(f => a.has(f));
  if (shared.length / c.size >= 0.7) note('SHOULD', 'Follow through / overlap', null, `${label(b.id)} keys on the same frames as its parent ${label(b.parent)} (${shared.length}/${c.size} shared). Child parts stop and start together with the parent: puppet look.`, `Offset ${label(b.id)} 1 to 2 frames after ${label(b.parent)} (2 to 4 for loose parts like hair, tails, hands).`);
}

/* ---------- 3. settle frames: everything stops at once ---------- */
{
  const moving = {}; // per bone, frames where angular speed is above epsilon
  for (const b of P.bones) {
    moving[b.id] = [];
    // own motion only (local channels): parts riding rigidly on a parent do not count as separate stops
    for (let f = F0 + 1; f <= F1; f++) { const A = poses[f].locals[b.id], B = poses[f - 1].locals[b.id]; moving[b.id].push(Math.abs(A.a - B.a) > 0.25 || Math.hypot(A.x - B.x, A.y - B.y) > 0.3 || Math.abs(A.sx - B.sx) > 0.002 || Math.abs(A.sy - B.sy) > 0.002); }
  }
  const stopsAt = {}; // frame -> bones that stop there after moving 3+ frames
  for (const id in moving) {
    const m = moving[id];
    for (let i = 3; i < m.length - 2; i++) if (m[i - 1] && m[i - 2] && m[i - 3] && !m[i] && !m[i + 1]) (stopsAt[F0 + 1 + i] = stopsAt[F0 + 1 + i] || []).push(id);
  }
  for (const f in stopsAt) if (stopsAt[f].length >= 4) note('SHOULD', 'Follow through / overlap', [+f, +f], `${stopsAt[f].length} parts stop on the same frame (${stopsAt[f].slice(0, 5).map(label).join(', ')}).`, 'Stagger the settles: body first, then head, arms, hands, hair last, 1 to 3 frames apart, with a small overshoot on loose parts.');
}

/* ---------- 4. anticipation before big moves ---------- */
for (const id in tracks) {
  const ks = tracks[id].a; if (!ks) continue;
  for (let i = 0; i < ks.length - 1; i++) {
    const d = ks[i + 1][1] - ks[i][1], dur = ks[i + 1][0] - ks[i][0];
    if (Math.abs(d) < 30 || dur > 14 || ks[i][0] < F0) continue; // big, fairly fast move
    const prev = ks[i - 1];
    const counter = prev && ks[i][0] - prev[0] <= 10 && Math.sign(ks[i][1] - prev[1]) === -Math.sign(d) && Math.abs(ks[i][1] - prev[1]) >= Math.abs(d) * 0.04;
    const parentCounter = byId[id] && byId[id].parent && (() => { // or a counter-move on the body (spine dip etc.)
      const pk = tracks[byId[id].parent]; if (!pk) return false;
      return Object.values(pk).some(t => t.some(k => k[0] < ks[i][0] && k[0] >= ks[i][0] - 8));
    })();
    if (!counter && !parentCounter) note('SHOULD', 'Anticipation', [ks[i][0], ks[i + 1][0]], `${label(id)} swings ${Math.round(d)} deg in ${dur} frames with no anticipation.`, `Add a counter-move of about ${Math.round(Math.abs(d) * 0.1)} deg (5 to 15%) in the opposite direction 3 to 8 frames before F${ks[i][0]}, or a body dip that sets it up.`);
  }
}

/* ---------- 5. dead holds ---------- */
{
  let run = 0, start = null;
  const flush = end => { if (run >= 12) note('COULD', 'Moving hold', [start, end], `${run} frames with no motion anywhere: a dead freeze.`, 'Keep the pose alive: 1 to 3 percent drift on the torso or head, a breath on the spine, an eye dart or blink.'); run = 0; start = null; };
  for (let f = F0 + 1; f <= F1; f++) {
    let maxd = 0;
    for (const b of P.bones) { const a = tip(poses[f], b.id), c = tip(poses[f - 1], b.id); maxd = Math.max(maxd, Math.hypot(a[0] - c[0], a[1] - c[1])); }
    const sw = P.layers.some(l => poses[f].layers[l.id] && poses[f - 1].layers[l.id] && poses[f].layers[l.id].switch !== poses[f - 1].layers[l.id].switch);
    if (maxd < 0.15 && !sw) { if (start === null) start = f; run++; } else flush(f - 1);
  }
  flush(F1);
}

/* ---------- 6. anatomy: hinge joints bending backward ---------- */
const HINGE = /(lo|lower|fore|shin|calf|knee|elbow)/i;
for (const b of P.bones) {
  if (!b.parent || !HINGE.test(b.id + ' ' + (b.name || ''))) continue;
  const restBend = RK.normDeg(worldAngle(rest, b.id) - worldAngle(rest, b.parent));
  const dir = Math.abs(restBend) > 3 ? Math.sign(restBend) : null; // natural bend side, if the rest pose shows one
  if (!dir) continue;
  const isLeg = /(leg|shin|calf|knee|thigh)/i.test(b.id + ' ' + (b.name || ''));
  const bends = []; for (let f = F0; f <= F1; f++) bends.push(RK.normDeg(worldAngle(poses[f], b.id) - worldAngle(poses[f], b.parent)) * dir);
  // (a) just past straight the wrong way (8 to 35 deg): reads as a locked, hyperextended joint.
  //     Bigger reversed bends on ARMS are usually a rotated shoulder (palm-out wave) and are fine in 2D;
  //     on legs in side view any reversed bend is broken.
  const hyper = [];
  // only frames where the joint HOVERS there (changing < 4 deg/frame); passing through during a swing is fine
  bends.forEach((v, i) => {
    const sp = Math.max(Math.abs(v - (bends[i - 1] ?? v)), Math.abs((bends[i + 1] ?? v) - v));
    if (v < -8 && (isLeg || v > -35) && (isLeg || sp < 4)) hyper.push(F0 + i);
  });
  if (hyper.length) note(isLeg ? 'MUST' : 'SHOULD', 'Anatomy: hinge joint', [hyper[0], hyper[hyper.length - 1]],
    `${label(b.id)} goes ${isLeg ? 'backwards past straight' : 'just past straight the wrong way (8 to 35 deg)'} relative to ${label(b.parent)} on ${hyper.length} frame(s): reads as a hyperextended ${isLeg ? 'knee' : 'elbow'}.`,
    isLeg ? 'Knees flex one way only (0 to about 135-150 deg). Move the hips instead of straightening past 0.' : 'Keep at least 5 to 15 deg of bend, or commit to a clear reversed bend (shoulder rotated, palm out) instead of hovering near straight.');
  // (b) snap through straight: the bend flips side within 3 frames = joint pop
  for (let i = 0; i < bends.length - 1; i++) for (let j = i + 1; j <= Math.min(i + 3, bends.length - 1); j++)
    if (bends[i] > 15 && bends[j] < -8) { note('SHOULD', 'Anatomy: hinge pop', [F0 + i, F0 + j], `${label(b.id)} flips its bend from ${Math.round(bends[i])} to ${Math.round(bends[j])} deg in ${j - i} frame(s): the joint snaps through straight.`, 'Slow the flip down (4+ frames) and hide it in a fast move, or keep the same bend side and get the pose from the parent.'); i = j; break; }
}

/* ---------- 7. anatomy: raised arm without shoulder (clavicle) rise ---------- */
for (const b of P.bones) {
  if (!/arm.*(up|upper)|upper.?arm|humer/i.test(b.id + ' ' + (b.name || ''))) continue;
  const restA = worldAngle(rest, b.id);
  let raised = [];
  for (let f = F0; f <= F1; f++) { const a = worldAngle(poses[f], b.id); if (Math.sin(a * Math.PI / 180) < -0.5) raised.push(f); } // pointing above about 30 deg over horizontal
  if (!raised.length) continue;
  const par = b.parent && byId[b.parent];
  const parentIsShoulder = par && /(shoulder|clav|scap)/i.test(par.id + ' ' + (par.name || ''));
  const shoulderMoves = parentIsShoulder && tracks[par.id];
  if (!shoulderMoves) note('SHOULD', 'Anatomy: shoulder girdle', [raised[0], raised[raised.length - 1]], `${label(b.id)} is raised high but no shoulder/clavicle part rises with it (arm pivots from a fixed socket).`, 'Above about 90 deg the shoulder blade and collarbone carry about a third of the lift (2:1 rhythm, clavicle up to 15 deg). Add a shoulder bone/layer and raise it 8 to 15 deg, or cheat with a shirt-shoulder swap.');
}

/* ---------- 8. twinning: left/right mirrored curves ---------- */
const pairOf = id => { const m = id.match(/^(.*?)(L|R)(_.*|$)/); return m ? m[1] + (m[2] === 'L' ? 'R' : 'L') + m[3] : null; };
const done = new Set();
for (const id in tracks) {
  const o = pairOf(id); if (!o || !tracks[o] || done.has(id) || !tracks[id].a || !tracks[o].a) continue;
  done.add(id); done.add(o);
  const A = [], B = [];
  for (let f = F0; f <= F1; f++) { A.push(poses[f].locals[id].a - (byId[id].angle || 0)); B.push(poses[f].locals[o].a - (byId[o].angle || 0)); }
  const mean = v => v.reduce((p, c) => p + c, 0) / v.length, ma = mean(A), mb = mean(B);
  let num = 0, da = 0, db = 0; for (let i = 0; i < A.length; i++) { num += (A[i] - ma) * (B[i] - mb); da += (A[i] - ma) ** 2; db += (B[i] - mb) ** 2; }
  const corr = da && db ? num / Math.sqrt(da * db) : 0;
  const ampA = Math.max(...A) - Math.min(...A), ampB = Math.max(...B) - Math.min(...B);
  if (Math.abs(corr) > 0.95 && ampA > 5 && ampB > 5 && Math.min(ampA, ampB) / Math.max(ampA, ampB) > 0.7)
    note('SHOULD', 'Solid drawing: twins', null, `${label(id)} and ${label(o)} move as mirror twins (correlation ${corr.toFixed(2)}).`, 'Break the symmetry: different amplitude, a 2 to 4 frame offset, one side acting and one side resting.');
}

/* ---------- 9. squash and stretch keeps volume ---------- */
for (const b of P.bones) {
  if (/(eye|lid|blink|brow|mouth|pupil)/i.test(b.id + ' ' + (b.name || ''))) continue; // blinks and lids close, they are not mass squash
  let worst = 0, wf = null;
  for (let f = F0; f <= F1; f++) { const L = poses[f].locals[b.id]; if (L.sx === 1 && L.sy === 1) continue; const v = Math.abs(L.sx * L.sy - 1); if (v > worst) { worst = v; wf = f; } }
  if (worst > 0.08) note('SHOULD', 'Squash and stretch', [wf, wf], `${label(b.id)} changes area by ${Math.round(worst * 100)}% (sx*sy far from 1): it inflates or shrinks instead of squashing.`, 'Keep sx*sy close to 1: stretch 1.1 means squash the other axis to about 0.91.');
}

/* ---------- 10. arcs: hand / head tips travelling in straight lines ---------- */
for (const b of P.bones) {
  if (kids(b.id).length || !(b.length > 0)) continue;
  if (!/(hand|head|foot|tip|wrist)/i.test(b.id + ' ' + (b.name || ''))) continue;
  const ks = [...new Set(Object.values(tracks[b.id] || {}).flat().map(k => k[0]))];
  // look at the tip path across every 6+ frame window between any keys on the chain
  const chainKeys = new Set(ks); let p = b.parent; while (p) { Object.values(tracks[p] || {}).flat().forEach(k => chainKeys.add(k[0])); p = byId[p] && byId[p].parent; }
  const kf = [...chainKeys].filter(f => f >= F0 && f <= F1).sort((x, y) => x - y);
  for (let i = 0; i < kf.length - 1; i++) {
    const a = kf[i], c = kf[i + 1]; if (c - a < 6) continue;
    const pa = tip(poses[a], b.id), pc = tip(poses[c], b.id), chord = Math.hypot(pc[0] - pa[0], pc[1] - pa[1]);
    if (chord < height * 0.1) continue;
    let dev = 0;
    for (let f = a + 1; f < c; f++) { const q = tip(poses[f], b.id); dev = Math.max(dev, RK.distToSeg(q[0], q[1], pa[0], pa[1], pc[0], pc[1])); }
    if (dev / chord < 0.02) note('SHOULD', 'Arcs', [a, c], `${label(b.id)} travels in a straight line (${Math.round(chord)} px, bow ${Math.round(dev / chord * 100)}%).`, 'Add a breakdown that pushes the path onto an arc (5 to 20% of the distance off the straight line), usually dipping under gravity.');
  }
}

/* ---------- 11. timing contrast ---------- */
{
  const durs = [];
  for (const id in tracks) for (const ch in tracks[id]) { const ks = tracks[id][ch]; for (let i = 0; i < ks.length - 1; i++) if (ks[i][1] !== ks[i + 1][1]) durs.push(ks[i + 1][0] - ks[i][0]); }
  if (durs.length >= 6) {
    durs.sort((x, y) => x - y);
    const lo = durs[Math.floor(durs.length * 0.1)], hi = durs[Math.floor(durs.length * 0.9)];
    if (hi / Math.max(1, lo) < 2) note('SHOULD', 'Timing', null, `Moves are all about the same length (${lo} to ${hi} frames): no contrast between snaps and slow moves.`, 'Contrast timing: a quick 3 to 6 frame snap against 12 to 24 frame moves and real holds.');
    const intervals = {}; for (const d of durs) intervals[d] = (intervals[d] || 0) + 1;
    const top = Object.entries(intervals).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] / durs.length > 0.5 && durs.length > 10) note('COULD', 'Timing', null, `${Math.round(top[1] / durs.length * 100)}% of moves last exactly ${top[0]} frames: metronome timing.`, 'Vary key intervals; let the acting decide them.');
  }
}

/* ---------- 12. rig limits ---------- */
for (const b of P.bones) {
  if (!b.constraint || !b.constraint.enabled) continue;
  const hit = []; for (let f = F0; f <= F1; f++) { const a = poses[f].locals[b.id].a; if (a <= b.constraint.min + 0.01 || a >= b.constraint.max - 0.01) hit.push(f); }
  if (hit.length > 2) note('COULD', 'Rig limit', [hit[0], hit[hit.length - 1]], `${label(b.id)} sits on its angle limit for ${hit.length} frames (pose is being clamped).`, 'Reach the pose with the parent instead, or request a wider range or a new drawing.');
}

/* ---------- report ---------- */
const order = { MUST: 0, SHOULD: 1, COULD: 2 };
notes.sort((a, b) => order[a.sev] - order[b.sev] || ((a.frames && a.frames[0]) || 0) - ((b.frames && b.frames[0]) || 0));
if (asJSON) { console.log(JSON.stringify({ file, frames: [F0, F1], notes }, null, 1)); process.exit(0); }
console.log(`anim-lint  ${path.basename(file)}  frames ${F0}-${F1}  (${notes.length} note${notes.length === 1 ? '' : 's'})`);
const counts = notes.reduce((m, n) => (m[n.sev] = (m[n.sev] || 0) + 1, m), {});
console.log(`MUST ${counts.MUST || 0} · SHOULD ${counts.SHOULD || 0} · COULD ${counts.COULD || 0}\n`);
for (const n of notes) {
  console.log(`[${n.sev}] ${n.rule}${n.frames ? '  ' + fr(n.frames[0], n.frames[1]) : ''}\n  ${n.msg}\n  fix: ${n.fix}\n`);
}
process.exit(counts.MUST ? 1 : 0);
