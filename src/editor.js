/*
 * AI Rigging editor
 * Moho-like workflow:
 *   Frame 0  = setup mode. Add bones, place art, bind layers, set rest pose.
 *   Frame 1+ = animation mode. Posing bones auto-keys the current frame.
 *   Smart bone action mode = posing records corrective keys against a dial angle.
 */
(function () {
  'use strict';
  const RK = window.RigKit, M = RK.M;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const DEG = Math.PI / 180;

  const S = {
    P: null, images: {}, frame: 0, playing: false, tool: 'select',
    sel: null,            // {type:'bone'|'layer', id}
    view: { x: 0, y: 0, z: 1 },
    sim: new RK.Simulator(),
    action: null, dial: 0, // smart bone id being edited
    selKey: null,          // {store, kind, id, ch, f} or {summary:true, f}
    undo: [], redo: [],
    drag: null, hover: null, pose: null,
    onion: false, dynamics: true, showBones: true, loop: true,
    collapsed: new Set()
  };
  $('#ver').textContent = 'v' + RK.VERSION;

  /* ------------------------------------------------------------ utilities */
  let toastT;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200);
  }
  const uid = (prefix, taken) => { let i = 1; while (taken(prefix + i)) i++; return prefix + i; };
  const boneById = id => S.P.bones.find(b => b.id === id);
  const layerById = id => S.P.layers.find(l => l.id === id);
  const round = (v, d = 2) => Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function download(name, data, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  const fileName = ext => (S.P.name || 'rig').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + ext;
  function descendants(id) {
    const out = new Set([id]); let grew = true;
    while (grew) { grew = false; for (const b of S.P.bones) if (b.parent && out.has(b.parent) && !out.has(b.id)) { out.add(b.id); grew = true; } }
    return out;
  }

  /* -------------------------------------------------------- state changes */
  function snapshot() { const { assets, ...rest } = S.P; return JSON.stringify(rest); }
  function checkpoint() { S.undo.push(snapshot()); if (S.undo.length > 80) S.undo.shift(); S.redo = []; }
  function restore(json) { const assets = S.P.assets; S.P = JSON.parse(json); S.P.assets = assets; changed(true); }
  function undo() { if (!S.undo.length) return toast('Nothing to undo'); S.redo.push(snapshot()); restore(S.undo.pop()); }
  function redo() { if (!S.redo.length) return toast('Nothing to redo'); S.undo.push(snapshot()); restore(S.redo.pop()); }

  let saveT;
  function changed(full) {
    S.sim.reset();
    if (S.sel && ((S.sel.type === 'bone' && !boneById(S.sel.id)) || (S.sel.type === 'layer' && !layerById(S.sel.id)))) S.sel = null;
    if (S.action && !boneById(S.action)) S.action = null;
    if (full) { syncImages(); refreshLists(); }
    refreshInspector(); refreshTimelineBar(); draw();
    clearTimeout(saveT); saveT = setTimeout(autosave, 800);
  }
  function autosave() { try { localStorage.setItem('ai-rigging-autosave', JSON.stringify(S.P)); } catch (e) { /* quota or privacy mode */ } }

  function syncImages() {
    for (const id in S.P.assets) {
      if (S.images[id] && S.images[id].src === S.P.assets[id]) continue;
      const img = new Image(); img.onload = () => draw(); img.src = S.P.assets[id]; S.images[id] = img;
    }
  }

  function loadProject(p, msg) {
    if (!p || !Array.isArray(p.bones) || !Array.isArray(p.layers)) return toast('Not an AI Rigging project');
    p.assets = p.assets || {}; p.anim = p.anim || { bones: {}, layers: {} }; p.actions = p.actions || {};
    S.P = p; S.sel = null; S.action = null; S.selKey = null; S.undo = []; S.redo = [];
    S.frame = Math.min(1, p.frames); S.images = {};
    syncImages(); fitView(); changed(true); if (msg) toast(msg);
  }

  /* -------------------------------------------------------------- posing */
  function evalPose(frame, dyn) {
    const f = frame == null ? S.frame : frame;
    return RK.evaluate(S.P, f, {
      sim: S.sim, dynamics: dyn == null ? (S.dynamics && (S.playing || S.drag == null)) : dyn,
      action: S.action ? { bone: S.action, dial: S.dial } : null
    });
  }
  const isSetup = () => !S.action && S.frame === 0;
  function modeStore() { if (S.action) { S.P.actions[S.action] = S.P.actions[S.action] || { bones: {}, layers: {} }; return S.P.actions[S.action]; } return S.P.anim; }
  const modeFrame = () => (S.action ? Math.round(S.dial) : S.frame);

  // Set a bone channel so that its evaluated local value becomes `desired`.
  function setBoneChannel(id, ch, desired, pose) {
    const b = boneById(id); if (!b) return;
    if (isSetup()) {
      if (ch === 'a') b.angle = desired; else if (ch === 'x') b.x = desired; else if (ch === 'y') b.y = desired;
      return;
    }
    if (S.action === id && ch === 'a') { S.dial = desired - (b.angle || 0); return; } // dragging the dial itself
    const L = (pose || evalPose(null, false)).locals[id][ch];
    const keys = RK.trackOf(modeStore(), 'bones', id, ch, true);
    const f = modeFrame();
    const cur = RK.sampleTrack(keys, f); const T = cur === undefined ? RK.channelDefault(ch) : cur;
    let v = RK.isMult(ch) ? (Math.abs(L) > 1e-6 ? T * desired / L : desired) : T + (desired - L);
    RK.setKey(keys, f, round(v, 3), S.action ? 'linear' : undefined);
  }

  function setLayerSwitch(id, idx) {
    const l = layerById(id); if (!l) return;
    if (isSetup()) { l.active = idx; return; }
    RK.setKey(RK.trackOf(modeStore(), 'layers', id, 'switch', true), modeFrame(), idx, 'step');
  }

  function keyAll() {
    if (!S.sel) return toast('Select a bone or layer first');
    if (isSetup()) return toast('Frame 0 is the setup pose. Go to frame 1+ to key');
    checkpoint();
    const pose = evalPose(null, false);
    if (S.sel.type === 'bone') { for (const ch of ['a', 'x', 'y']) setBoneChannel(S.sel.id, ch, pose.locals[S.sel.id][ch], pose); }
    else setLayerSwitch(S.sel.id, pose.layers[S.sel.id].switch);
    changed(); toast('Keyed');
  }

  /* ---------------------------------------------------------------- view */
  const cv = $('#stage'), ctx = cv.getContext('2d');
  const dpr = () => window.devicePixelRatio || 1;
  function resize() {
    const r = cv.getBoundingClientRect();
    cv.width = Math.max(1, r.width * dpr()); cv.height = Math.max(1, r.height * dpr());
    const t = $('#tl'), tr = t.getBoundingClientRect();
    t.width = Math.max(1, tr.width * dpr()); t.height = Math.max(1, tr.height * dpr());
    draw(); drawTimeline();
  }
  function fitView() {
    const r = cv.getBoundingClientRect(); if (!r.width || !S.P) return;
    const z = Math.min((r.width - 40) / S.P.width, (r.height - 40) / S.P.height);
    S.view.z = Math.max(0.05, z); S.view.x = (r.width - S.P.width * S.view.z) / 2; S.view.y = (r.height - S.P.height * S.view.z) / 2;
    draw();
  }
  const viewM = () => { const d = dpr(), z = S.view.z; return [z * d, 0, 0, z * d, S.view.x * d, S.view.y * d]; };
  function toWorld(e) {
    const r = cv.getBoundingClientRect();
    return [(e.clientX - r.left - S.view.x) / S.view.z, (e.clientY - r.top - S.view.y) / S.view.z];
  }

  /* ---------------------------------------------------------------- draw */
  let raf = 0;
  function draw() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; drawNow(); }); }
  function drawNow() {
    if (!S.P) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#121317'; ctx.fillRect(0, 0, cv.width, cv.height);
    const V = viewM();
    ctx.setTransform(V[0], V[1], V[2], V[3], V[4], V[5]);
    ctx.fillStyle = S.P.background || '#fff'; ctx.fillRect(0, 0, S.P.width, S.P.height);

    if (S.onion && !S.action && S.frame >= 1) {
      for (const [df, tint] of [[-3, 0.22], [3, 0.14]]) {
        const f = S.frame + df; if (f < 1 || f > S.P.frames) continue;
        RK.render(ctx, S.P, evalPose(f), S.images, { view: V, alpha: tint });
      }
    }
    const pose = S.pose = evalPose();
    RK.render(ctx, S.P, pose, S.images, { view: V });

    ctx.setTransform(V[0], V[1], V[2], V[3], V[4], V[5]);
    ctx.strokeStyle = '#0006'; ctx.lineWidth = 1 / S.view.z; ctx.strokeRect(0, 0, S.P.width, S.P.height);

    // selected layer outline
    if (S.sel && S.sel.type === 'layer') {
      const l = layerById(S.sel.id);
      const outl = l ? (RK.isGroup(l) ? groupLeaves(l.id) : [l]) : [];
      for (const l of outl) {
        ctx.setTransform(V[0], V[1], V[2], V[3], V[4], V[5]);
        ctx.lineWidth = 1.5 / S.view.z; ctx.strokeStyle = '#ff9f43';
        if (l.screenLock) { ctx.setLineDash([2 / S.view.z, 4 / S.view.z]); ctx.strokeRect(l.x, l.y, l.w, l.h); ctx.setLineDash([]); continue; }
        if (l.bind === 'mesh' && RK.layerBones(l, S.P).length) {
          const { md, pts } = RK.deformMesh(S.P, l, pose);
          ctx.strokeStyle = '#ff9f4388'; ctx.beginPath();
          for (let t = 0; t < md.tris.length; t += 3) {
            const a = md.tris[t], b = md.tris[t + 1], c = md.tris[t + 2];
            ctx.moveTo(pts[a * 2], pts[a * 2 + 1]); ctx.lineTo(pts[b * 2], pts[b * 2 + 1]); ctx.lineTo(pts[c * 2], pts[c * 2 + 1]); ctx.closePath();
          }
          ctx.stroke();
        } else {
          const m = M.mul(V, RK.boneDelta(pose, RK.effectiveBone(S.P, l)));
          ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
          ctx.setLineDash([6 / S.view.z, 4 / S.view.z]); ctx.strokeRect(l.x, l.y, l.w, l.h); ctx.setLineDash([]);
        }
      }
    }

    if (S.showBones || S.tool === 'bone') drawBones(pose, V);

    if (S.drag && S.drag.kind === 'newbone') {
      ctx.setTransform(V[0], V[1], V[2], V[3], V[4], V[5]);
      ctx.strokeStyle = '#ff9f43'; ctx.lineWidth = 3 / S.view.z;
      ctx.beginPath(); ctx.moveTo(S.drag.a[0], S.drag.a[1]); ctx.lineTo(S.drag.b[0], S.drag.b[1]); ctx.stroke();
    }
    updateBadge();
    drawTimeline();
  }

  function drawBones(pose, V) {
    ctx.setTransform(V[0], V[1], V[2], V[3], V[4], V[5]);
    const z = S.view.z;
    for (const b of S.P.bones) {
      const w = pose.world[b.id]; if (!w) continue;
      const a = M.apply(w, 0, 0), t = M.apply(w, b.length || 0, 0);
      const ang = Math.atan2(t[1] - a[1], t[0] - a[0]);
      const len = Math.hypot(t[0] - a[0], t[1] - a[1]);
      const wd = Math.min(10 / z, Math.max(3 / z, len * 0.12));
      const sel = S.sel && S.sel.type === 'bone' && S.sel.id === b.id;
      const hov = S.hover === b.id;
      let col = b.smart ? '#9c8cff' : b.dynamics && b.dynamics.enabled ? '#3fd0d4' : '#f2f2f5';
      if (sel) col = '#ff9f43';
      ctx.save(); ctx.translate(a[0], a[1]); ctx.rotate(ang);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.min(len * 0.2, 14 / z), -wd); ctx.lineTo(len, 0); ctx.lineTo(Math.min(len * 0.2, 14 / z), wd); ctx.closePath();
      ctx.fillStyle = col + (sel || hov ? 'dd' : '88'); ctx.fill();
      ctx.lineWidth = 1.2 / z; ctx.strokeStyle = '#000a'; ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 3.5 / z, 0, Math.PI * 2); ctx.fillStyle = '#000b'; ctx.fill();
      if (b.smart) { ctx.beginPath(); ctx.arc(len, 0, 5 / z, 0, Math.PI * 2); ctx.strokeStyle = '#9c8cff'; ctx.lineWidth = 2 / z; ctx.stroke(); }
      ctx.restore();
      if (b.parent && pose.world[b.parent]) { // dotted link from parent tip if detached
        const pb = boneById(b.parent); const pt = M.apply(pose.world[b.parent], pb.length || 0, 0);
        if (Math.hypot(pt[0] - a[0], pt[1] - a[1]) > 2) {
          ctx.setLineDash([3 / z, 3 / z]); ctx.strokeStyle = '#ffffff55'; ctx.lineWidth = 1 / z;
          ctx.beginPath(); ctx.moveTo(pt[0], pt[1]); ctx.lineTo(a[0], a[1]); ctx.stroke(); ctx.setLineDash([]);
        }
      }
      if (sel || hov) {
        ctx.fillStyle = '#fff'; ctx.font = `${11 / z}px system-ui`;
        ctx.fillText(b.name || b.id, t[0] + 6 / z, t[1] - 6 / z);
      }
    }
  }

  function updateBadge() {
    const el = $('#modeBadge');
    if (S.action) { el.className = 'action'; el.textContent = `ACTION · dial ${round(S.dial, 1)}°`; }
    else if (S.frame === 0) { el.className = 'setup'; el.textContent = 'SETUP · frame 0 (rigging)'; }
    else { el.className = 'anim'; el.textContent = `ANIMATE · frame ${S.frame} · auto-key`; }
    $('#actionBar').hidden = !S.action;
    if (S.action) $('#actionName').textContent = (boneById(S.action) || {}).name || S.action;
  }

  /* -------------------------------------------------------- hit testing */
  function hitBone(p, pose) {
    let best = null, bd = 9 / S.view.z;
    for (const b of S.P.bones) {
      const w = pose.world[b.id]; const a = M.apply(w, 0, 0), t = M.apply(w, b.length || 0, 0);
      const d = RK.distToSeg(p[0], p[1], a[0], a[1], t[0], t[1]);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
  function hitLayer(p, pose) {
    for (let i = S.P.layers.length - 1; i >= 0; i--) {
      const l = S.P.layers[i]; if (l.hidden || RK.isGroup(l) || l.screenLock || isHiddenByGroup(l)) continue;
      const q = M.apply(M.inv(RK.boneDelta(pose, RK.layerBones(l, S.P)[0])), p[0], p[1]);
      if (q[0] >= l.x && q[0] <= l.x + l.w && q[1] >= l.y && q[1] <= l.y + l.h) return l;
    }
    return null;
  }

  /* -------------------------------------------------------- stage input */
  let spaceDown = false;
  cv.addEventListener('pointerdown', e => {
    if (!S.P) return;
    cv.setPointerCapture(e.pointerId);
    const p = toWorld(e);
    if (S.playing) togglePlay();
    if (e.button === 1 || e.altKey || S.tool === 'hand' || spaceDown) {
      S.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: S.view.x, vy: S.view.y }; return;
    }
    const pose = evalPose(null, false);
    if (S.tool === 'bone') {
      if (!isSetup()) { toast('Bones are added on frame 0 (setup). Jumping there.'); setFrame(0); }
      S.drag = { kind: 'newbone', a: p, b: p }; return;
    }
    const bone = hitBone(p, pose);
    if (bone) {
      select({ type: 'bone', id: bone.id });
      checkpoint();
      const w = pose.world[bone.id], base = M.apply(w, 0, 0);
      if (S.tool === 'translate') {
        const pw = bone.parent ? pose.world[bone.parent] : M.ident();
        const lp = M.apply(M.inv(pw), p[0], p[1]);
        const L = pose.locals[bone.id];
        S.drag = { kind: 'translate', id: bone.id, off: [L.x - lp[0], L.y - lp[1]] };
      } else if (S.tool === 'ik') {
        S.drag = { kind: 'ik', id: bone.id };
      } else {
        S.drag = { kind: 'rotate', id: bone.id, base, start: Math.atan2(p[1] - base[1], p[0] - base[0]) / DEG, a0: pose.locals[bone.id].a };
      }
      return;
    }
    const layer = hitLayer(p, pose);
    if (layer) {
      select({ type: 'layer', id: layer.id });
      if (isSetup()) { checkpoint(); S.drag = { kind: 'movelayer', id: layer.id, p, x0: layer.x, y0: layer.y }; }
      return;
    }
    select(null);
  });

  cv.addEventListener('pointermove', e => {
    if (!S.P) return;
    const p = toWorld(e);
    const d = S.drag;
    if (!d) {
      const b = hitBone(p, S.pose || evalPose(null, false));
      const id = b ? b.id : null; if (id !== S.hover) { S.hover = id; draw(); }
      return;
    }
    if (d.kind === 'pan') { S.view.x = d.vx + e.clientX - d.sx; S.view.y = d.vy + e.clientY - d.sy; draw(); return; }
    if (d.kind === 'newbone') { d.b = p; draw(); return; }
    if (d.kind === 'movelayer') { const l = layerById(d.id); l.x = round(d.x0 + p[0] - d.p[0]); l.y = round(d.y0 + p[1] - d.p[1]); d.moved = true; draw(); return; }
    const pose = evalPose(null, false);
    if (d.kind === 'rotate') {
      let ang = Math.atan2(p[1] - d.base[1], p[0] - d.base[0]) / DEG;
      let delta = RK.normDeg(ang - d.start);
      // unwrap so continuous drags can pass 180
      if (d.prev != null) { while (delta - d.prev > 180) delta -= 360; while (delta - d.prev < -180) delta += 360; }
      d.prev = delta;
      setBoneChannel(d.id, 'a', round(d.a0 + delta, 2), pose); d.moved = true;
    } else if (d.kind === 'translate') {
      const b = boneById(d.id); const pw = b.parent ? pose.world[b.parent] : M.ident();
      const lp = M.apply(M.inv(pw), p[0], p[1]);
      setBoneChannel(d.id, 'x', round(lp[0] + d.off[0]), pose);
      setBoneChannel(d.id, 'y', round(lp[1] + d.off[1]), evalPose(null, false)); d.moved = true;
    } else if (d.kind === 'ik') {
      solveIK(d.id, p, pose); d.moved = true;
    }
    S.sim.reset(); refreshInspector(true); draw();
  });

  cv.addEventListener('pointerup', e => {
    const d = S.drag; S.drag = null;
    if (!d) return;
    if (d.kind === 'newbone') {
      const len = Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]);
      if (len > 4 / S.view.z) addBone(d.a, d.b);
    } else if (d.kind !== 'pan') {
      if (!d.moved) S.undo.pop(); // click without drag: drop the checkpoint
      changed();
    }
    draw();
  });

  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const f = Math.exp(-e.deltaY * 0.0015), nz = Math.max(0.05, Math.min(20, S.view.z * f));
    S.view.x = mx - (mx - S.view.x) * nz / S.view.z; S.view.y = my - (my - S.view.y) * nz / S.view.z; S.view.z = nz;
    draw();
  }, { passive: false });

  /* ------------------------------------------------------------------ IK */
  // CCD solve. Moves the tip of `id` toward target, rotating it and up to N-1 parents.
  function solveIK(id, target, pose) {
    const n = Math.max(1, parseInt($('#ikChain').value) || 2);
    const chain = []; let b = boneById(id);
    while (b && chain.length < n) { chain.push(b); b = b.parent ? boneById(b.parent) : null; }
    const locals = JSON.parse(JSON.stringify(pose.locals));
    const end = chain[0];
    for (let it = 0; it < 16; it++) {
      for (const cb of chain) {
        const world = RK.computeWorld(S.P, locals);
        const tip = M.apply(world[end.id], end.length || 0, 0);
        const base = M.apply(world[cb.id], 0, 0);
        const cur = Math.atan2(tip[1] - base[1], tip[0] - base[0]);
        const want = Math.atan2(target[1] - base[1], target[0] - base[0]);
        const det = world[cb.id][0] * world[cb.id][3] - world[cb.id][1] * world[cb.id][2];
        let da = RK.normDeg((want - cur) / DEG) * (det < 0 ? -1 : 1);
        let na = locals[cb.id].a + da * 0.8;
        if (cb.constraint && cb.constraint.enabled) na = Math.max(cb.constraint.min, Math.min(cb.constraint.max, na));
        locals[cb.id].a = na;
      }
    }
    for (const cb of chain) {
      // keep the result close to the current value (no 360 flips)
      let na = locals[cb.id].a, cur = pose.locals[cb.id].a;
      na = cur + RK.normDeg(na - cur);
      setBoneChannel(cb.id, 'a', round(na, 2), evalPose(null, false));
    }
  }

  /* ---------------------------------------------------- bones and layers */
  function addBone(a, b) {
    checkpoint();
    const parent = S.sel && S.sel.type === 'bone' ? boneById(S.sel.id) : null;
    const pose = RK.evaluate(S.P, 0, {});
    const wa = Math.atan2(b[1] - a[1], b[0] - a[0]) / DEG;
    const nb = { id: uid('bone', id => !!boneById(id)), name: '', parent: parent ? parent.id : null, x: a[0], y: a[1], angle: round(wa), length: round(Math.hypot(b[0] - a[0], b[1] - a[1])) };
    nb.name = 'Bone ' + nb.id.slice(4);
    if (parent) {
      const pw = pose.world[parent.id];
      const lp = M.apply(M.inv(pw), a[0], a[1]);
      nb.x = round(lp[0]); nb.y = round(lp[1]); nb.angle = round(RK.normDeg(wa - M.angle(pw)));
    } else { nb.x = round(a[0]); nb.y = round(a[1]); }
    S.P.bones.push(nb);
    S.sel = { type: 'bone', id: nb.id };
    changed(true);
  }

  function deleteBone(id) {
    checkpoint();
    const b = boneById(id);
    const pose = RK.evaluate(S.P, 0, {});
    for (const c of S.P.bones) if (c.parent === id) { // re-parent children, keep their world rest
      const w = pose.world[c.id]; const np = b.parent ? pose.world[b.parent] : M.ident();
      const rel = M.mul(M.inv(np), w);
      c.parent = b.parent || null; c.x = round(rel[4]); c.y = round(rel[5]); c.angle = round(M.angle(rel));
    }
    S.P.bones = S.P.bones.filter(x => x !== b);
    for (const l of S.P.layers) { if (l.bone === id) l.bone = null; if (l.bones) l.bones = l.bones.filter(x => x !== id); }
    delete S.P.anim.bones[id]; delete S.P.actions[id];
    for (const a in S.P.actions) if (S.P.actions[a].bones) delete S.P.actions[a].bones[id];
    changed(true);
  }

  function reparent(id, pid) {
    const b = boneById(id);
    if (pid && descendants(id).has(pid)) return toast('Cannot parent a bone to its own child');
    checkpoint();
    const pose = RK.evaluate(S.P, 0, {});
    const w = pose.world[id]; const np = pid ? pose.world[pid] : M.ident();
    const rel = M.mul(M.inv(np), w);
    b.parent = pid || null; b.x = round(rel[4]); b.y = round(rel[5]); b.angle = round(M.angle(rel));
    changed(true);
  }

  function readFiles(files) {
    return Promise.all(Array.from(files).filter(f => f.type.startsWith('image/')).map(f => new Promise(res => {
      const r = new FileReader();
      r.onload = () => { const img = new Image(); img.onload = () => res({ name: f.name.replace(/\.[^.]+$/, ''), url: r.result, w: img.naturalWidth || 100, h: img.naturalHeight || 100 }); img.onerror = () => res(null); img.src = r.result; };
      r.readAsDataURL(f);
    }))).then(a => a.filter(Boolean));
  }
  function addAsset(name, url) {
    const id = uid(name.replace(/[^\w]+/g, '_').slice(0, 24) + '_', k => !!S.P.assets[k]);
    S.P.assets[id] = url; return id;
  }
  function fitRect(w, h) {
    const s = Math.min(1, (S.P.height * 0.6) / h, (S.P.width * 0.6) / w);
    return { w: round(w * s), h: round(h * s), x: round((S.P.width - w * s) / 2), y: round((S.P.height - h * s) / 2) };
  }
  function addImageLayers(files, asSwitch) {
    readFiles(files).then(list => {
      if (!list.length) return;
      checkpoint();
      if (!isSetup()) setFrameRaw(0);
      const bone = S.sel && S.sel.type === 'bone' ? S.sel.id : null;
      const selG = S.sel && S.sel.type === 'layer' && RK.isGroup(layerById(S.sel.id)) ? S.sel.id : null;
      const mk = (name, drawings, w, h) => {
        const l = Object.assign({ id: uid('layer', id => !!layerById(id)), name, drawings, bone, group: selG, bind: 'rigid', opacity: 1, active: 0, hidden: false, mesh: { cols: 6, rows: 6 } }, fitRect(w, h));
        S.P.layers.push(l); return l;
      };
      let last;
      if (asSwitch) last = mk('Switch', list.map(it => ({ name: it.name, asset: addAsset(it.name, it.url) })), list[0].w, list[0].h);
      else for (const it of list) last = mk(it.name, [{ name: it.name, asset: addAsset(it.name, it.url) }], it.w, it.h);
      S.sel = { type: 'layer', id: last.id };
      changed(true);
      toast(bone ? 'Added and bound to the selected bone' : 'Added. Bind it to a bone in the inspector');
    });
  }
  function addDrawings(layerId, files) {
    readFiles(files).then(list => {
      const l = layerById(layerId); if (!l || !list.length) return;
      checkpoint();
      for (const it of list) l.drawings.push({ name: it.name, asset: addAsset(it.name, it.url) });
      changed(true);
    });
  }
  // ---- layer tree helpers
  const groupOf = l => (l.group && layerById(l.group)) ? l.group : null;
  function siblings(groupId) { return S.P.layers.filter(l => groupOf(l) === (groupId || null)); }
  function groupLeaves(gid) {
    const out = [];
    for (const l of siblings(gid)) { if (RK.isGroup(l)) out.push(...groupLeaves(l.id)); else out.push(l); }
    return out;
  }
  function isHiddenByGroup(l) { let g = groupOf(l), n = 0; while (g && n++ < 64) { const gl = layerById(g); if (gl.hidden) return true; g = groupOf(gl); } return false; }
  function groupDescendants(gid) { const set = new Set([gid]); let grew = true; while (grew) { grew = false; for (const l of S.P.layers) if (l.group && set.has(l.group) && !set.has(l.id)) { set.add(l.id); grew = true; } } return set; }
  function moveLayer(id, dir) {
    const l = layerById(id); const sib = siblings(groupOf(l));
    const k = sib.indexOf(l), other = sib[k + dir]; if (!other) return;
    checkpoint();
    const a = S.P.layers, i = a.indexOf(l), j = a.indexOf(other);
    [a[i], a[j]] = [a[j], a[i]]; changed(true);
  }
  function addGroup() {
    checkpoint();
    const sel = S.sel && S.sel.type === 'layer' ? layerById(S.sel.id) : null;
    const bone = S.sel && S.sel.type === 'bone' ? S.sel.id : (sel ? RK.effectiveBone(S.P, sel) : null);
    const g = { id: uid('group', id => !!layerById(id)), name: 'Group', type: 'group', drawings: [], bone, blend: 'normal', opacity: 1, hidden: false, group: sel ? groupOf(sel) : null };
    if (sel) {
      S.P.layers.splice(S.P.layers.indexOf(sel), 0, g);
      sel.group = g.id; if (sel.bone === bone) sel.bone = null; // child now follows the group's bone
      g.name = sel.name + ' group';
    } else S.P.layers.push(g);
    S.sel = { type: 'layer', id: g.id }; S.collapsed.delete(g.id);
    changed(true); toast('Group created. Set its bone once; children without a bone follow it.');
  }
  function ungroup(gid, deleteKids) {
    checkpoint();
    const g = layerById(gid); const parent = groupOf(g);
    if (deleteKids) { const d = groupDescendants(gid); S.P.layers = S.P.layers.filter(l => !d.has(l.id)); }
    else {
      for (const l of S.P.layers) if (l.group === gid) { l.group = parent; if (!l.bone && g.bone && l.bind !== 'mesh') l.bone = g.bone; }
      S.P.layers = S.P.layers.filter(l => l !== g);
    }
    delete S.P.anim.layers[gid]; changed(true);
  }
  function setLayerGroup(l, gid) {
    if (gid && groupDescendants(l.id).has(gid)) return toast('Cannot put a group inside itself');
    const eff = RK.effectiveBone(S.P, l);
    l.group = gid || null;
    if (!l.bone && eff && RK.effectiveBone(S.P, l) !== eff) l.bone = eff; // keep it following the same bone
    // keep children after their new group in the array so draw order inside the group stays predictable
    if (gid) { const a = S.P.layers; a.splice(a.indexOf(l), 1); const sibs = a.filter(x => x.group === gid); const after = sibs.length ? a.indexOf(sibs[sibs.length - 1]) : a.indexOf(layerById(gid)); a.splice(after + 1, 0, l); }
  }

  // ---- part stack importer: arm_color.png, arm_shadow.png, arm_line.png ... -> one clipped, blended group
  const ROLES = [
    ['color', /(?:^|[_\-\s.])(colou?r|fill|base|flats?|paint)$/i, { order: 0 }],
    ['texture', /(?:^|[_\-\s.])(texture|tex|grain|paper|pattern)$/i, { order: 1, clip: true, blend: 'multiply', opacity: 0.6 }],
    ['shadow', /(?:^|[_\-\s.])(shadows?|shade|shading|sh|tone)$/i, { order: 2, clip: true, blend: 'multiply' }],
    ['highlight', /(?:^|[_\-\s.])(highlights?|hl|light|rim|shine|glow)$/i, { order: 3, clip: true, blend: 'screen' }],
    ['line', /(?:^|[_\-\s.])(lines?|ink|lineart|outline|stroke)$/i, { order: 4 }]
  ];
  function roleOf(name) {
    for (const [role, re, cfg] of ROLES) { const m = name.match(re); if (m) return { role, cfg, prefix: name.slice(0, m.index).replace(/[_\-\s.]+$/, '') || 'part' }; }
    return { role: 'other', cfg: { order: 5 }, prefix: name };
  }
  function addPartStacks(files) {
    readFiles(files).then(list => {
      if (!list.length) return;
      checkpoint(); if (!isSetup()) setFrameRaw(0);
      const bone = S.sel && S.sel.type === 'bone' ? S.sel.id : null;
      const groups = {};
      for (const it of list) { const r = roleOf(it.name); (groups[r.prefix] = groups[r.prefix] || []).push(Object.assign(it, r)); }
      let lastG;
      for (const prefix in groups) {
        const items = groups[prefix].sort((a, b) => a.cfg.order - b.cfg.order);
        const hasBase = items.some(i => i.role === 'color');
        const rect = fitRect(items[0].w, items[0].h), sc = rect.w / items[0].w;
        const g = { id: uid('group', id => !!layerById(id)), name: prefix, type: 'group', drawings: [], bone, blend: 'normal', opacity: 1, hidden: false, group: null };
        S.P.layers.push(g);
        for (const it of items) {
          const clip = hasBase && !!it.cfg.clip;
          S.P.layers.push({ id: uid('layer', id => !!layerById(id)), name: `${prefix} ${it.role === 'other' ? it.name : it.role}`, drawings: [{ name: it.name, asset: addAsset(it.name, it.url) }],
            group: g.id, bone: null, bind: 'rigid', opacity: it.cfg.opacity || 1, active: 0, hidden: false, mesh: { cols: 6, rows: 6 },
            blend: clip ? it.cfg.blend : 'normal', clip, x: rect.x, y: rect.y, w: round(it.w * sc), h: round(it.h * sc) });
        }
        lastG = g;
      }
      S.sel = { type: 'layer', id: lastG.id }; changed(true);
      toast(`Built ${Object.keys(groups).length} part stack(s). Shadow = multiply, highlight = screen, texture = multiply, all clipped to colour.`);
    });
  }

  /* ---------------------------------------------------------- selection */
  function select(sel) {
    S.sel = sel; S.selKey = null; refreshLists(); refreshInspector(); refreshTimelineBar(); draw();
  }

  function refreshLists() {
    const ll = $('#layerList'); ll.innerHTML = '';
    const addRows = (gid, depth) => {
      const sib = siblings(gid);
      for (let i = sib.length - 1; i >= 0; i--) {
        const l = sib[i], isG = RK.isGroup(l);
        const li = document.createElement('li');
        if (S.sel && S.sel.type === 'layer' && S.sel.id === l.id) li.className = 'sel';
        li.style.paddingLeft = (6 + depth * 14) + 'px';
        const bound = isG ? (l.bone ? 'bone' : '') : l.screenLock ? 'lock' : l.bind === 'mesh' ? 'mesh' : l.bone ? 'bone' : '';
        const blend = l.blend && l.blend !== 'normal' ? l.blend.replace('color-', 'c-').slice(0, 7) : '';
        li.innerHTML = `<span class="ic eye">${l.hidden ? '◌' : '●'}</span>` +
          (isG ? `<span class="ic fold">${S.collapsed.has(l.id) ? '▸' : '▾'}</span>` : (l.clip ? '<span class="ic clipic" title="Clipped to the layer below">↳</span>' : '')) +
          `<span class="nm${isG ? ' grp' : ''}">${esc(l.name)}</span>` +
          ((l.drawings || []).length > 1 ? `<span class="tag">⇄${l.drawings.length}</span>` : '') +
          (blend ? `<span class="tag blend">${blend}</span>` : '') + (bound ? `<span class="tag">${bound}</span>` : '') +
          `<button class="mini up" title="Bring forward">▲</button><button class="mini dn" title="Send back">▼</button>`;
        li.onclick = ev => {
          if (ev.target.classList.contains('eye')) { checkpoint(); l.hidden = !l.hidden; changed(true); return; }
          if (ev.target.classList.contains('fold')) { S.collapsed.has(l.id) ? S.collapsed.delete(l.id) : S.collapsed.add(l.id); refreshLists(); return; }
          if (ev.target.classList.contains('up')) return moveLayer(l.id, 1);
          if (ev.target.classList.contains('dn')) return moveLayer(l.id, -1);
          select({ type: 'layer', id: l.id });
        };
        ll.appendChild(li);
        if (isG && !S.collapsed.has(l.id)) addRows(l.id, depth + 1);
      }
    };
    addRows(null, 0);
    const bl = $('#boneList'); bl.innerHTML = '';
    const depth = b => { let d = 0, p = b; while (p && p.parent && d < 50) { p = boneById(p.parent); d++; } return d; };
    for (const b of RK.sortBones(S.P.bones)) {
      const li = document.createElement('li');
      if (S.sel && S.sel.type === 'bone' && S.sel.id === b.id) li.className = 'sel';
      li.style.paddingLeft = (6 + depth(b) * 12) + 'px';
      li.innerHTML = `<span class="ic">╱</span><span class="nm">${esc(b.name || b.id)}</span>` +
        (b.smart ? '<span class="tag smart">smart</span>' : '') + (b.dynamics && b.dynamics.enabled ? '<span class="tag dyn">dyn</span>' : '');
      li.onclick = () => select({ type: 'bone', id: b.id });
      bl.appendChild(li);
    }
  }

  /* ---------------------------------------------------------- inspector */
  function field(label, html) { return `<label class="field"><span>${label}</span>${html}</label>`; }
  const num = (k, v, step) => `<input type="number" data-k="${k}" value="${v}" step="${step || 'any'}">`;
  const txt = (k, v) => `<input type="text" data-k="${k}" value="${esc(v || '')}">`;
  const chk = (k, v, label) => `<label><input type="checkbox" data-k="${k}" ${v ? 'checked' : ''}> ${label}</label>`;

  function refreshInspector(liveOnly) {
    const box = $('#inspector');
    if (liveOnly) { // only update numeric live values while dragging
      if (S.sel && S.sel.type === 'bone') {
        const b = boneById(S.sel.id); const pose = evalPose(null, false); const L = pose.locals[b.id];
        const live = box.querySelector('[data-live]'); if (live) live.textContent = `angle ${round(L.a, 1)}°  x ${round(L.x, 1)}  y ${round(L.y, 1)}`;
      }
      return;
    }
    if (!S.P) return;
    if (!S.sel) return inspectProject(box);
    if (S.sel.type === 'bone') return inspectBone(box, boneById(S.sel.id));
    const sl = layerById(S.sel.id);
    return RK.isGroup(sl) ? inspectGroup(box, sl) : inspectLayer(box, sl);
  }

  function bind(box, handlers) {
    box.querySelectorAll('[data-k]').forEach(el => {
      const k = el.dataset.k; const h = handlers[k]; if (!h) return;
      const ev = el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'change';
      el.addEventListener(ev, () => {
        const v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? parseFloat(el.value) : el.value;
        if (el.type === 'number' && !isFinite(v)) return;
        checkpoint(); h(v, el); changed(true);
      });
    });
    box.querySelectorAll('[data-act]').forEach(el => el.addEventListener('click', () => handlers['@' + el.dataset.act](el)));
  }

  function inspectProject(box) {
    $('#inspTitle').textContent = 'Project';
    const P = S.P;
    box.innerHTML = field('Name', txt('name', P.name)) +
      field('Size', `<div class="pair">${num('width', P.width, 1)}${num('height', P.height, 1)}</div>`) +
      field('Background', `<input type="color" data-k="background" value="${P.background || '#ffffff'}">`) +
      `<p class="note">Bones ${P.bones.length} · Layers ${P.layers.length} · Assets ${Object.keys(P.assets).length}</p>` +
      `<div class="sub"><h4>Workflow</h4><p class="note">1. On <b>frame 0</b> import art, add bones (B), bind each layer to a bone.<br>2. Go to <b>frame 1+</b> and pose: every drag auto-keys.<br>3. Mark a bone as <b>Smart</b> to drive corrective poses and switch drawings by its angle.<br>4. Export a standalone HTML player or a video.</p></div>`;
    bind(box, {
      name: v => P.name = v, width: v => P.width = Math.max(16, v | 0), height: v => P.height = Math.max(16, v | 0),
      background: v => P.background = v
    });
  }

  function inspectBone(box, b) {
    $('#inspTitle').textContent = 'Bone';
    const parents = S.P.bones.filter(x => !descendants(b.id).has(x.id));
    const pose = evalPose(null, false); const L = pose.locals[b.id];
    const c = b.constraint || { enabled: false, min: -180, max: 180 };
    const dy = b.dynamics || { enabled: false, stiffness: 0.18, damping: 0.18, gravity: 0 };
    box.innerHTML = field('Name', txt('name', b.name)) +
      field('ID', `<span class="muted">${esc(b.id)}</span>`) +
      field('Parent', `<select data-k="parent"><option value="">(none)</option>${parents.map(p => `<option value="${p.id}" ${p.id === b.parent ? 'selected' : ''}>${esc(p.name || p.id)}</option>`).join('')}</select>`) +
      field('Length', num('length', round(b.length), 1)) +
      field('Strength', num('strength', round(b.strength || 0), 1)) +
      `<p class="note">Strength = mesh influence radius (0 = auto). Bigger means softer bends.</p>` +
      `<div class="sub"><h4>Rest pose (frame 0)</h4>` +
      field('Position', `<div class="pair">${num('x', round(b.x), 1)}${num('y', round(b.y), 1)}</div>`) +
      field('Angle°', num('angle', round(b.angle), 1)) +
      `<p class="note" data-live>angle ${round(L.a, 1)}°  x ${round(L.x, 1)}  y ${round(L.y, 1)}</p></div>` +
      `<div class="sub"><h4>Angle constraint</h4><div class="checks">${chk('cEnabled', c.enabled, 'enabled')}</div>` +
      field('Min / max°', `<div class="pair">${num('cMin', c.min, 1)}${num('cMax', c.max, 1)}</div>`) + `<p class="note">Absolute local angle range. Also limits IK.</p></div>` +
      `<div class="sub"><h4>Bone dynamics</h4><div class="checks">${chk('dEnabled', dy.enabled, 'jiggle / follow-through')}</div>` +
      field('Stiffness', num('dStiff', dy.stiffness, 0.01)) + field('Damping', num('dDamp', dy.damping, 0.01)) + field('Gravity', num('dGrav', dy.gravity || 0, 0.1)) +
      `<p class="note">Simulated on playback. Great for antennas, tails, ears, hair.</p></div>` +
      `<div class="sub"><h4>Smart bone</h4><div class="checks">${chk('smart', !!b.smart, 'this bone is a dial')}</div>` +
      (b.smart ? field('Dial min / max°', `<div class="pair">${num('sMin', b.smart.min, 1)}${num('sMax', b.smart.max, 1)}</div>`) +
        `<div class="btnrow"><button data-act="editAction">${S.action === b.id ? 'Editing…' : 'Edit action'}</button><button data-act="clearAction" class="danger">Clear action</button></div>` +
        `<p class="note">Rotating this bone (dial) plays its action: corrective bone poses and drawing swaps keyed against the dial angle.</p>` : '') + `</div>` +
      `<div class="sub"><div class="btnrow"><button data-act="addChild">+ Child bone tool</button><button data-act="del" class="danger">Delete bone</button></div></div>`;
    bind(box, {
      name: v => b.name = v, parent: v => { S.undo.pop(); reparent(b.id, v || null); },
      length: v => b.length = Math.max(1, v), strength: v => b.strength = Math.max(0, v),
      x: v => b.x = v, y: v => b.y = v, angle: v => b.angle = v,
      cEnabled: v => b.constraint = Object.assign({}, c, { enabled: v }), cMin: v => b.constraint = Object.assign({}, c, { min: v }), cMax: v => b.constraint = Object.assign({}, c, { max: v }),
      dEnabled: v => b.dynamics = Object.assign({}, dy, { enabled: v }), dStiff: v => b.dynamics = Object.assign({}, dy, { stiffness: Math.max(0.001, Math.min(1, v)) }),
      dDamp: v => b.dynamics = Object.assign({}, dy, { damping: Math.max(0, Math.min(0.99, v)) }), dGrav: v => b.dynamics = Object.assign({}, dy, { gravity: v }),
      smart: v => { if (v) b.smart = { min: 0, max: 90 }; else { delete b.smart; if (S.action === b.id) S.action = null; } },
      sMin: v => b.smart.min = v, sMax: v => b.smart.max = v,
      '@editAction': () => enterAction(b.id),
      '@clearAction': () => { if (!confirm('Delete every key in this smart bone action?')) return; checkpoint(); delete S.P.actions[b.id]; changed(true); },
      '@addChild': () => setTool('bone'),
      '@del': () => deleteBone(b.id)
    });
  }

  function inspectGroup(box, g) {
    $('#inspTitle').textContent = 'Group';
    const pose = evalPose(null, false);
    const groups = S.P.layers.filter(x => RK.isGroup(x) && !groupDescendants(g.id).has(x.id));
    const kids = siblings(g.id);
    box.innerHTML = field('Name', txt('name', g.name)) +
      field('Bone', `<select data-k="bone"><option value="">(none)</option>${S.P.bones.map(b => `<option value="${b.id}" ${b.id === g.bone ? 'selected' : ''}>${esc(b.name || b.id)}</option>`).join('')}</select>`) +
      `<p class="note">Children without their own bone follow this one. Bind the group once instead of every colour, shadow and line layer.</p>` +
      field('Inside', `<select data-k="group"><option value="">(top level)</option>${groups.map(x => `<option value="${x.id}" ${x.id === g.group ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`) +
      field('Blend', `<select data-k="blend">${RK.BLENDS.map(b => `<option value="${b}" ${b === (g.blend || 'normal') ? 'selected' : ''}>${b}</option>`).join('')}</select>`) +
      field('Opacity', num('opacity', g.opacity == null ? 1 : g.opacity, 0.05)) +
      `<div class="checks">${chk('clip', g.clip, 'clip to layer below')}</div>` +
      field('Z offset', num('zKey', pose.layers[g.id] ? pose.layers[g.id].z || 0 : 0, 1)) +
      `<p class="note">${kids.length} layer(s) inside. A group with a blend mode or opacity under 1 is composited as one image (isolated), otherwise children blend straight through.</p>` +
      `<div class="sub"><div class="btnrow"><button data-act="ungroup">Ungroup</button><button data-act="delAll" class="danger">Delete group + contents</button></div></div>`;
    bind(box, {
      name: v => g.name = v, bone: v => g.bone = v || null, blend: v => g.blend = v, clip: v => g.clip = v,
      group: v => setLayerGroup(g, v || null),
      opacity: v => g.opacity = Math.max(0, Math.min(1, v)),
      zKey: v => { if (isSetup()) { toast('Z offset is keyed on frame 1+. On frame 0 use the layer order arrows.'); return; } RK.setKey(RK.trackOf(modeStore(), 'layers', g.id, 'z', true), modeFrame(), Math.round(v), 'step'); },
      '@ungroup': () => ungroup(g.id, false),
      '@delAll': () => { if (confirm('Delete this group and every layer inside it?')) ungroup(g.id, true); }
    });
  }

  function inspectLayer(box, l) {
    $('#inspTitle').textContent = l.drawings.length > 1 ? 'Switch layer' : 'Image layer';
    const pose = evalPose(null, false);
    const cur = pose.layers[l.id] ? pose.layers[l.id].switch : 0;
    const boneOpts = `<option value="">(none)</option>` + S.P.bones.map(b => `<option value="${b.id}" ${b.id === l.bone ? 'selected' : ''}>${esc(b.name || b.id)}</option>`).join('');
    const meshB = RK.layerBones(l, S.P);
    const groups = S.P.layers.filter(g => RK.isGroup(g));
    const blendOpts = RK.BLENDS.map(b => `<option value="${b}" ${b === (l.blend || 'normal') ? 'selected' : ''}>${b}</option>`).join('');
    const inherited = !l.bone && RK.effectiveBone(S.P, l);
    box.innerHTML = field('Name', txt('name', l.name)) +
      `<div class="sub"><h4>Drawings ${l.drawings.length > 1 ? '(switch)' : ''}</h4>` +
      l.drawings.map((d, i) => `<div class="draw"><input type="radio" name="sw" data-sw="${i}" ${i === cur ? 'checked' : ''} title="Show this drawing (keys it on frame 1+)"><img src="${S.P.assets[d.asset] || ''}"><input type="text" data-dn="${i}" value="${esc(d.name)}">${l.drawings.length > 1 ? `<button data-dd="${i}" class="mini danger" title="Remove">✕</button>` : ''}</div>`).join('') +
      `<div class="btnrow"><button data-act="addDrawing">+ Drawing</button></div><p class="note">More than one drawing makes this a switch layer (mouths, hands, eyes, head turns). Picking a drawing on frame 1+ sets a stepped key.</p></div>` +
      `<div class="sub"><h4>Compositing</h4>` +
      field('Group', `<select data-k="group"><option value="">(top level)</option>${groups.map(g => `<option value="${g.id}" ${g.id === l.group ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select>`) +
      field('Blend', `<select data-k="blend">${blendOpts}</select>`) +
      `<div class="checks">${chk('clip', l.clip, 'clip to layer below')}${chk('screenLock', l.screenLock, 'lock to screen (texture)')}</div>` +
      `<p class="note">Typical part stack: colour (base) · texture multiply, clipped · shadow multiply, clipped · highlight screen, clipped · line on top. Lock to screen keeps a texture still while the part moves.</p></div>` +
      `<div class="sub"><h4>Binding</h4>` +
      field('Bone', `<select data-k="bone">${boneOpts.replace('(none)', inherited ? '(follow group: ' + esc((boneById(inherited) || {}).name || inherited) + ')' : '(none)')}</select>`) +
      field('Mode', `<select data-k="bind"><option value="rigid" ${l.bind !== 'mesh' ? 'selected' : ''}>Rigid (layer binding)</option><option value="mesh" ${l.bind === 'mesh' ? 'selected' : ''}>Mesh (bends, smart warp)</option></select>`) +
      (l.bind === 'mesh' ? field('Mesh cols / rows', `<div class="pair">${num('mCols', (l.mesh && l.mesh.cols) || 6, 1)}${num('mRows', (l.mesh && l.mesh.rows) || 6, 1)}</div>`) +
        field('Weight falloff', num('mFall', (l.mesh && l.mesh.falloff) || 2.5, 0.1)) +
        `<p class="note">Lower = softer joints (fixes folds at elbows and knees), higher = stiffer segments. Influencing bones (weights by distance and bone strength):</p><div class="checks">${S.P.bones.map(b => `<label><input type="checkbox" data-mb="${b.id}" ${meshB.includes(b.id) ? 'checked' : ''}> ${esc(b.name || b.id)}</label>`).join('')}</div>` : '') +
      `</div><div class="sub"><h4>Placement (frame 0)</h4>` +
      field('Position', `<div class="pair">${num('x', l.x, 1)}${num('y', l.y, 1)}</div>`) +
      field('Size', `<div class="pair">${num('w', l.w, 1)}${num('h', l.h, 1)}</div>`) +
      field('Scale %', num('scale', 100, 1)) +
      field('Flip', `<div class="checks">${chk('flipX', l.flipX, 'horizontal')}${chk('flipY', l.flipY, 'vertical')}</div>`) +
      field('Opacity', num('opacity', l.opacity == null ? 1 : l.opacity, 0.05)) +
      field('Z offset', num('zKey', pose.layers[l.id] ? pose.layers[l.id].z || 0 : 0, 1)) +
      `<p class="note">Z offset is keyed (stepped) on frame 1+: +3 moves this layer 3 places toward the front for that part of the shot, e.g. an arm crossing in front of the body.</p>` +
      `<p class="note">Moving art on frame 0 does not move bones, and moving bones on frame 0 does not move bound art (Moho style).</p></div>` +
      `<div class="sub"><div class="btnrow"><button data-act="dup">Duplicate</button><button data-act="del" class="danger">Delete layer</button></div></div>`;
    bind(box, {
      name: v => l.name = v,
      group: v => setLayerGroup(l, v || null),
      blend: v => l.blend = v, clip: v => l.clip = v, screenLock: v => l.screenLock = v,
      bone: v => { l.bone = v || null; if (l.bind === 'mesh' && v && !(l.bones || []).length) l.bones = [v]; },
      bind: v => { l.bind = v; if (v === 'mesh' && !(l.bones && l.bones.length) && l.bone) { const kids = S.P.bones.filter(b => b.parent === l.bone).map(b => b.id); l.bones = [l.bone, ...kids]; } l.mesh = l.mesh || { cols: 6, rows: 6 }; },
      mFall: v => l.mesh = Object.assign({}, l.mesh, { falloff: Math.max(1, Math.min(8, v)) }),
      mCols: v => l.mesh = Object.assign({}, l.mesh, { cols: Math.max(1, Math.min(64, v | 0)) }), mRows: v => l.mesh = Object.assign({}, l.mesh, { rows: Math.max(1, Math.min(64, v | 0)) }),
      x: v => l.x = v, y: v => l.y = v, w: v => l.w = Math.max(1, v), h: v => l.h = Math.max(1, v),
      scale: v => { const s = Math.max(1, v) / 100, cx = l.x + l.w / 2, cy = l.y + l.h / 2; l.w = round(l.w * s); l.h = round(l.h * s); l.x = round(cx - l.w / 2); l.y = round(cy - l.h / 2); },
      opacity: v => l.opacity = Math.max(0, Math.min(1, v)),
      flipX: v => l.flipX = v, flipY: v => l.flipY = v,
      zKey: v => { if (isSetup()) { toast('Z offset is keyed on frame 1+. On frame 0 use the layer order arrows.'); return; } RK.setKey(RK.trackOf(modeStore(), 'layers', l.id, 'z', true), modeFrame(), Math.round(v), 'step'); },
      '@addDrawing': () => { const f = $('#fileDrawing'); f.dataset.layer = l.id; f.value = ''; f.click(); },
      '@dup': () => { checkpoint(); const c = JSON.parse(JSON.stringify(l)); c.id = uid('layer', id => !!layerById(id)); c.name += ' copy'; S.P.layers.splice(S.P.layers.indexOf(l) + 1, 0, c); S.sel = { type: 'layer', id: c.id }; changed(true); },
      '@del': () => { checkpoint(); S.P.layers = S.P.layers.filter(x => x !== l); delete S.P.anim.layers[l.id]; changed(true); }
    });
    box.querySelector('[data-k="bone"]').querySelector('option[value=""]').textContent = inherited ? `(follow group: ${(boneById(inherited) || {}).name || inherited})` : '(none)';
    box.querySelectorAll('[data-sw]').forEach(el => el.addEventListener('change', () => { checkpoint(); setLayerSwitch(l.id, +el.dataset.sw); changed(true); }));
    box.querySelectorAll('[data-dn]').forEach(el => el.addEventListener('change', () => { checkpoint(); l.drawings[+el.dataset.dn].name = el.value; changed(); }));
    box.querySelectorAll('[data-dd]').forEach(el => el.addEventListener('click', () => { checkpoint(); l.drawings.splice(+el.dataset.dd, 1); l.active = Math.min(l.active || 0, l.drawings.length - 1); changed(true); }));
    box.querySelectorAll('[data-mb]').forEach(el => el.addEventListener('change', () => {
      checkpoint(); const set = new Set(RK.layerBones(l, S.P)); if (el.checked) set.add(el.dataset.mb); else set.delete(el.dataset.mb); l.bones = Array.from(set); changed(true);
    }));
  }

  /* ------------------------------------------------------ smart actions */
  function enterAction(id) {
    const b = boneById(id); if (!b || !b.smart) return;
    if (S.playing) togglePlay();
    S.action = id; S.dial = b.smart.max; S.selKey = null;
    S.P.actions[id] = S.P.actions[id] || { bones: {}, layers: {} };
    toast(`Action mode: dial set to ${b.smart.max}°. Pose the rig for this dial value.`);
    changed(true);
  }
  function exitAction() { S.action = null; S.selKey = null; changed(true); }

  /* ------------------------------------------------------------ timeline */
  const tl = $('#tl'), tctx = tl.getContext('2d');
  const LABEL_W = 140, RULER_H = 20, ROW_H = 20;

  function tlDomain() {
    if (S.action) { const b = boneById(S.action); return { a: Math.floor(b.smart.min), b: Math.ceil(b.smart.max), cur: S.dial, unit: '°' }; }
    return { a: 0, b: S.P.frames, cur: S.frame, unit: '' };
  }
  function tlRows() {
    const store = modeStore();
    const rows = [{ label: S.action ? 'Action keys' : 'All keys', summary: true }];
    const addBoneRows = id => {
      const b = boneById(id); if (!b) return;
      for (const ch of RK.BONE_CHANNELS) {
        const keys = RK.trackOf(store, 'bones', id, ch, false);
        if (S.sel && S.sel.type === 'bone' && S.sel.id === id && (ch === 'a' || ch === 'x' || ch === 'y' || (keys && keys.length)) || (keys && keys.length && S.action))
          rows.push({ label: `${b.name || id} · ${ch}`, kind: 'bones', id, ch, keys });
      }
    };
    const addLayerRows = id => {
      const l = layerById(id); if (!l) return;
      for (const ch of RK.LAYER_CHANNELS) {
        const keys = RK.trackOf(store, 'layers', id, ch, false);
        if ((S.sel && S.sel.type === 'layer' && S.sel.id === id && (ch === 'switch' || (keys && keys.length))) || (keys && keys.length && S.action))
          rows.push({ label: `${l.name} · ${ch}`, kind: 'layers', id, ch, keys });
      }
    };
    if (S.action) { for (const b of S.P.bones) addBoneRows(b.id); for (const l of S.P.layers) addLayerRows(l.id); }
    else if (S.sel) { if (S.sel.type === 'bone') addBoneRows(S.sel.id); else addLayerRows(S.sel.id); }
    // de-duplicate (action mode may add selection twice)
    const seen = new Set(); return rows.filter(r => { const k = r.summary ? 's' : r.kind + r.id + r.ch; if (seen.has(k)) return false; seen.add(k); return true; });
  }
  function allKeyFrames() {
    const set = new Set(); const st = modeStore();
    for (const kind of ['bones', 'layers']) for (const id in (st[kind] || {})) for (const ch in st[kind][id]) for (const k of st[kind][id][ch]) set.add(k[0]);
    return set;
  }
  function tlX(f, dom, W) { const span = Math.max(1, dom.b - dom.a); return LABEL_W + 8 + (f - dom.a) / span * (W - LABEL_W - 16); }
  function tlF(x, dom, W) { const span = Math.max(1, dom.b - dom.a); return dom.a + (x - LABEL_W - 8) / (W - LABEL_W - 16) * span; }

  function drawTimeline() {
    if (!S.P) return;
    const d = dpr(), W = tl.width / d, H = tl.height / d;
    tctx.setTransform(d, 0, 0, d, 0, 0);
    tctx.fillStyle = '#1e2026'; tctx.fillRect(0, 0, W, H);
    const dom = tlDomain(), rows = tlRows();
    const span = dom.b - dom.a, px = (W - LABEL_W - 16) / Math.max(1, span);
    const every = px > 14 ? 1 : px > 6 ? 5 : px > 2 ? 10 : 25;
    tctx.font = '10px system-ui'; tctx.textBaseline = 'middle';
    for (let f = Math.ceil(dom.a); f <= dom.b; f++) {
      const x = tlX(f, dom, W);
      const major = f % (every * (every === 1 ? 5 : 2)) === 0;
      if (f % every === 0 || f === dom.a) {
        tctx.fillStyle = major ? '#3a3d47' : '#2a2c33'; tctx.fillRect(Math.round(x), RULER_H, 1, H - RULER_H);
        tctx.fillStyle = '#9aa0ad'; tctx.fillText(f + dom.unit, x + 2, RULER_H / 2);
      }
    }
    if (!S.action) { // setup frame shading
      tctx.fillStyle = '#2f3b7a55'; const x0 = tlX(0, dom, W); tctx.fillRect(x0 - 3, RULER_H, 6, H - RULER_H);
    }
    rows.forEach((r, i) => {
      const y = RULER_H + i * ROW_H;
      tctx.fillStyle = i % 2 ? '#22242b' : '#25272f'; tctx.fillRect(0, y, LABEL_W, ROW_H);
      tctx.fillStyle = r.summary ? '#ff9f43' : '#cfd2da'; tctx.fillText(r.label.length > 22 ? r.label.slice(0, 21) + '…' : r.label, 8, y + ROW_H / 2);
      tctx.fillStyle = '#ffffff08'; tctx.fillRect(LABEL_W, y + ROW_H - 1, W, 1);
      const frames = r.summary ? Array.from(allKeyFrames()) : (r.keys || []).map(k => k[0]);
      for (const f of frames) {
        const x = tlX(f, dom, W), cy = y + ROW_H / 2, s = r.summary ? 5 : 6;
        const isSel = S.selKey && S.selKey.f === f && (r.summary ? S.selKey.summary : (!S.selKey.summary && S.selKey.kind === r.kind && S.selKey.id === r.id && S.selKey.ch === r.ch));
        const key = !r.summary && r.keys.find(k => k[0] === f);
        tctx.beginPath(); tctx.moveTo(x, cy - s); tctx.lineTo(x + s, cy); tctx.lineTo(x, cy + s); tctx.lineTo(x - s, cy); tctx.closePath();
        tctx.fillStyle = isSel ? '#ffffff' : r.summary ? '#ff9f43' : key && key[2] === 'step' ? '#ff5a6a' : r.kind === 'layers' ? '#3fd0d4' : '#9c8cff';
        tctx.fill(); tctx.strokeStyle = '#000'; tctx.lineWidth = 1; tctx.stroke();
      }
    });
    const cx = tlX(dom.cur, dom, W);
    tctx.fillStyle = '#ff5a6a'; tctx.fillRect(cx - 0.5, 0, 1.5, H);
    tctx.beginPath(); tctx.moveTo(cx - 5, 0); tctx.lineTo(cx + 5, 0); tctx.lineTo(cx, 8); tctx.fill();
    tctx.fillStyle = '#ffffff'; tctx.fillText(round(dom.cur, 1) + dom.unit, cx + 6, 10);
    if (!rows.length || rows.length === 1) { tctx.fillStyle = '#9aa0ad'; tctx.fillText(S.sel ? '' : 'Select a bone or layer to see its channels', LABEL_W + 16, RULER_H + ROW_H * 1.5); }
  }

  let tlDrag = null;
  tl.addEventListener('pointerdown', e => {
    if (!S.P) return;
    tl.setPointerCapture(e.pointerId);
    const r = tl.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, W = r.width;
    const dom = tlDomain(), rows = tlRows();
    const ri = Math.floor((y - RULER_H) / ROW_H);
    if (y > RULER_H && rows[ri] && x > LABEL_W) {
      const row = rows[ri];
      const frames = row.summary ? Array.from(allKeyFrames()) : (row.keys || []).map(k => k[0]);
      const hit = frames.find(f => Math.abs(tlX(f, dom, W) - x) < 7);
      if (hit !== undefined) {
        S.selKey = row.summary ? { summary: true, f: hit } : { kind: row.kind, id: row.id, ch: row.ch, f: hit };
        checkpoint(); tlDrag = { key: true, f0: hit, moved: false };
        refreshTimelineBar(); drawTimeline(); return;
      }
    }
    S.selKey = null; refreshTimelineBar();
    tlDrag = { key: false };
    scrubTo(tlF(x, dom, W));
  });
  tl.addEventListener('pointermove', e => {
    if (!tlDrag) return;
    const r = tl.getBoundingClientRect(), x = e.clientX - r.left, dom = tlDomain();
    let f = Math.round(tlF(x, dom, r.width));
    f = Math.max(S.action ? dom.a : 1, Math.min(dom.b, f));
    if (tlDrag.key) { if (f !== S.selKey.f) { moveSelKey(f); tlDrag.moved = true; } }
    else scrubTo(tlF(x, dom, r.width));
  });
  tl.addEventListener('pointerup', () => { if (tlDrag && tlDrag.key) { if (!tlDrag.moved) S.undo.pop(); else changed(); } tlDrag = null; });

  function scrubTo(f) {
    if (S.action) { const b = boneById(S.action); S.dial = Math.max(b.smart.min, Math.min(b.smart.max, Math.round(f))); changed(); }
    else setFrame(Math.round(Math.max(0, Math.min(S.P.frames, f))));
  }
  function forSelKeys(fn) { // calls fn(keysArray, keyIndex)
    const sk = S.selKey; if (!sk) return; const st = modeStore();
    if (sk.summary) {
      for (const kind of ['bones', 'layers']) for (const id in (st[kind] || {})) for (const ch in st[kind][id]) {
        const ks = st[kind][id][ch]; const i = ks.findIndex(k => k[0] === sk.f); if (i >= 0) fn(ks, i, kind, ch);
      }
    } else { const ks = RK.trackOf(st, sk.kind, sk.id, sk.ch, false); if (!ks) return; const i = ks.findIndex(k => k[0] === sk.f); if (i >= 0) fn(ks, i, sk.kind, sk.ch); }
  }
  function moveSelKey(f) {
    let blocked = false;
    forSelKeys(ks => { if (ks.some(k => k[0] === f)) blocked = true; });
    if (blocked) return;
    forSelKeys((ks, i) => { ks[i][0] = f; ks.sort((a, b) => a[0] - b[0]); });
    S.selKey.f = f; S.sim.reset(); draw(); refreshTimelineBar();
  }
  function deleteSelKey() {
    if (!S.selKey) return toast('Select a key in the timeline first');
    checkpoint(); forSelKeys((ks, i) => ks.splice(i, 1)); S.selKey = null; changed();
  }

  /* ------------------------------------------------------ timeline bar */
  const easeSel = $('#easeSel');
  easeSel.innerHTML = RK.EASE_NAMES.map(n => `<option value="${n}">${n}</option>`).join('');
  easeSel.addEventListener('change', () => {
    if (!S.selKey) return toast('Select a key first');
    checkpoint(); forSelKeys((ks, i, kind, ch) => { ks[i][2] = (kind === 'layers' && ch === 'switch') ? 'step' : easeSel.value; }); changed();
  });
  function refreshTimelineBar() {
    if (!S.P) return;
    $('#frameInput').value = S.frame; $('#frameInput').max = S.P.frames;
    $('#framesInput').value = S.P.frames; $('#fpsInput').value = S.P.fps;
    $('#playBtn').textContent = S.playing ? '⏸' : '▶';
    let info = '';
    if (S.selKey) {
      let ease = null, val = null;
      forSelKeys((ks, i) => { if (ease == null) { ease = ks[i][2] || 'smooth'; val = ks[i][1]; } });
      if (ease != null) { easeSel.value = Array.isArray(ease) ? 'smooth' : ease; info = S.selKey.summary ? `frame ${S.selKey.f} (all keys)` : `${S.selKey.ch} = ${round(val, 2)} @ ${S.selKey.f}`; }
    }
    $('#keyInfo').textContent = info;
    $$('#tools button').forEach(b => b.classList.toggle('on', b.dataset.tool === S.tool));
  }

  function setFrameRaw(f) { S.frame = f; }
  function setFrame(f) {
    if (S.action) exitAction();
    S.frame = Math.max(0, Math.min(S.P.frames, f | 0));
    refreshInspector(); refreshTimelineBar(); draw();
  }

  /* ---------------------------------------------------------- playback */
  let playRaf = 0;
  function togglePlay() {
    if (!S.P) return;
    if (S.action) exitAction();
    S.playing = !S.playing;
    if (S.playing) {
      if (S.frame < 1 || S.frame >= S.P.frames) S.frame = 1;
      let last = performance.now(), acc = 0;
      const step = now => {
        if (!S.playing) return;
        acc += now - last; last = now; const spf = 1000 / S.P.fps; let adv = false;
        while (acc >= spf) {
          acc -= spf; adv = true; S.frame++;
          if (S.frame > S.P.frames) { if (S.loop) S.frame = 1; else { S.frame = S.P.frames; S.playing = false; } }
        }
        if (adv) { $('#frameInput').value = S.frame; drawNow(); }
        if (S.playing) playRaf = requestAnimationFrame(step); else refreshTimelineBar();
      };
      playRaf = requestAnimationFrame(step);
    } else cancelAnimationFrame(playRaf);
    refreshTimelineBar(); draw();
  }

  /* ------------------------------------------------------------ export */
  function exportHTML() {
    const proj = JSON.stringify(S.P).replace(/</g, '\\u003c');
    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(S.P.name)}</title>
<style>html,body{margin:0;height:100%;background:#111;display:grid;place-items:center}canvas{max-width:100vw;max-height:100vh;display:block}</style>
</head><body><canvas id="c"></canvas>
<script>
${RigKitEngine.toString()}
RigKitEngine(window);
var PROJECT = ${proj};
var player = new RigKit.Player(document.getElementById('c'), PROJECT, { loop: true, autoplay: true });
document.getElementById('c').addEventListener('click', function () { player.playing ? player.pause() : player.play(); });
<\/script>
<!-- Made with AI Rigging -->
</body></html>`;
    download(fileName('.html'), html, 'text/html');
    toast('Exported standalone HTML player');
  }

  function renderFrameTo(c, f, sim) {
    const x = c.getContext('2d');
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, c.width, c.height);
    const pose = RK.evaluate(S.P, f, { dynamics: S.dynamics, sim });
    RK.render(x, S.P, pose, S.images, { background: true });
  }

  function exportPNG() {
    const c = document.createElement('canvas'); c.width = S.P.width; c.height = S.P.height;
    renderFrameTo(c, S.frame, new RK.Simulator());
    c.toBlob(b => download(fileName(`_f${S.frame}.png`), b), 'image/png');
  }

  function exportWebM() {
    if (S.P.frames < 1) return toast('Nothing to record');
    if (!window.MediaRecorder) return toast('This browser cannot record video');
    const c = document.createElement('canvas'); c.width = S.P.width; c.height = S.P.height;
    const sim = new RK.Simulator();
    renderFrameTo(c, 1, sim);
    const stream = c.captureStream(0);
    const track = stream.getVideoTracks()[0];
    const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    const mime = types.find(t => MediaRecorder.isTypeSupported(t)) || '';
    let rec;
    try { rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8e6 }); } catch (e) { return toast('Recording failed: ' + e.message); }
    const chunks = []; rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    rec.onstop = () => { download(fileName(mime.includes('mp4') ? '.mp4' : '.webm'), new Blob(chunks, { type: mime || 'video/webm' })); toast('Video exported'); };
    rec.start();
    let f = 1; const spf = 1000 / S.P.fps; toast('Recording…');
    const tick = () => {
      renderFrameTo(c, f, sim);
      if (track.requestFrame) track.requestFrame();
      f++;
      if (f > S.P.frames) setTimeout(() => rec.stop(), spf); else setTimeout(tick, spf);
    };
    tick();
  }

  /* ------------------------------------------------------------- AI glue */
  function rigBrief() {
    const P = S.P, pose = RK.evaluate(P, 0, {});
    const lines = [];
    lines.push(`# AI Rigging rig brief: ${P.name}`);
    lines.push(`Stage ${P.width}x${P.height}px, ${P.fps} fps, ${P.frames} frames. Frame 0 is the rest (setup) pose; animation plays frames 1..${P.frames} and loops.`);
    lines.push('Angles are degrees. 0 points right, positive turns clockwise on screen (y axis points down).');
    lines.push('', '## Bones (id, name, parent, rest world angle, length, notes)');
    for (const b of RK.sortBones(P.bones)) {
      const wa = round(RK.M.angle(pose.world[b.id]), 1);
      const notes = [];
      if (b.constraint && b.constraint.enabled) notes.push(`local angle limited ${b.constraint.min}..${b.constraint.max}`);
      if (b.dynamics && b.dynamics.enabled) notes.push('dynamics (simulated, do not key)');
      if (b.smart) notes.push(`SMART DIAL ${b.smart.min}..${b.smart.max}: key its "a" channel to trigger its action`);
      lines.push(`- ${b.id} "${b.name}" parent=${b.parent || '-'} worldAngle=${wa} length=${round(b.length)}${notes.length ? ' | ' + notes.join('; ') : ''}`);
    }
    lines.push('', '## Layers (id, name, bound bone, drawings)');
    for (const l of P.layers) {
      const extra = [l.group ? 'in=' + l.group : '', l.blend && l.blend !== 'normal' ? 'blend=' + l.blend : '', l.clip ? 'clipped' : '', l.screenLock ? 'screen-locked' : ''].filter(Boolean).join(' ');
      if (RK.isGroup(l)) { lines.push(`- ${l.id} "${l.name}" GROUP bone=${l.bone || '-'} ${extra}`); continue; }
      lines.push(`- ${l.id} "${l.name}" bone=${l.bind === 'mesh' ? 'mesh[' + RK.layerBones(l, P).join(',') + ']' : (RK.effectiveBone(P, l) || '-')} drawings=[${l.drawings.map((d, i) => i + ':' + d.name).join(', ')}] ${extra}`);
    }
    const acts = Object.keys(P.actions || {});
    if (acts.length) {
      lines.push('', '## Smart bone actions');
      for (const a of acts) {
        const st = P.actions[a]; const parts = [];
        for (const id in (st.bones || {})) for (const ch in st.bones[id]) parts.push(`${id}.${ch}`);
        for (const id in (st.layers || {})) for (const ch in st.layers[id]) parts.push(`${id}.${ch}`);
        lines.push(`- ${a} drives: ${parts.join(', ') || '(empty)'}`);
      }
    }
    lines.push('', '## Channels',
      'Bones: a (degrees ADDED to rest angle), x / y (px added to rest position, in parent space), sx / sy (scale multipliers, 1 = rest; sx stretches along the bone).',
      'Layers: switch (drawing index, always stepped), opacity (0..1 multiplier), z (draw-order offset, stepped: +2 moves the layer two places toward the front).',
      '', '## Key format', 'Each key is [frame, value, ease]. Ease shapes the segment AFTER the key.',
      `Eases: ${RK.EASE_NAMES.join(', ')}, or a cubic bezier array [x1,y1,x2,y2].`,
      'To loop cleanly, put a key at frame (frames + 1) equal to the frame 1 key.',
      '', '## Reply with JSON only', '{"anim": {"bones": {"<boneId>": {"a": [[1,0,"smooth"],[12,-30,"overshoot"]]}}, "layers": {"<layerId>": {"switch": [[1,0,"step"]]}}}}',
      'Optional: "frames": <number>, "fps": <number>. Tip: favour breakdowns, offset child bones 1 to 3 frames behind parents, avoid every part stopping on the same frame.');
    return lines.join('\n');
  }

  function modal(title, text, value, buttons) {
    $('#modalTitle').textContent = title; $('#modalText').innerHTML = text || '';
    const area = $('#modalArea'); area.style.display = value == null ? 'none' : ''; area.value = value || '';
    const btns = $('#modalBtns'); btns.innerHTML = '';
    for (const [label, fn] of buttons) { const b = document.createElement('button'); b.textContent = label; b.onclick = () => { if (fn(area.value) !== false) $('#modal').hidden = true; }; btns.appendChild(b); }
    $('#modal').hidden = false; if (value != null) area.focus();
  }

  function pasteAnim(text, replace) {
    let j;
    try { j = JSON.parse(text.trim().replace(/^```(json)?/i, '').replace(/```$/, '')); } catch (e) { toast('Invalid JSON: ' + e.message); return false; }
    if (j.bones && j.layers) { loadProject(j, 'Project loaded'); return; }
    checkpoint();
    const merge = (dst, src) => {
      for (const kind of ['bones', 'layers']) for (const id in (src[kind] || {})) for (const ch in src[kind][id]) {
        const keys = (src[kind][id][ch] || []).filter(k => Array.isArray(k) && isFinite(k[0]) && isFinite(k[1])).map(k => [Math.round(k[0]), +k[1], k[2] || (ch === 'switch' ? 'step' : 'smooth')]);
        keys.sort((a, b) => a[0] - b[0]);
        dst[kind] = dst[kind] || {}; dst[kind][id] = dst[kind][id] || {};
        if (replace) dst[kind][id][ch] = keys; else { const t = dst[kind][id][ch] = dst[kind][id][ch] || []; for (const k of keys) RK.setKey(t, k[0], k[1], k[2]); }
      }
    };
    if (replace) S.P.anim = { bones: {}, layers: {} };
    if (j.anim) merge(S.P.anim, j.anim);
    if (j.actions) for (const a in j.actions) { S.P.actions[a] = S.P.actions[a] || { bones: {}, layers: {} }; merge(S.P.actions[a], j.actions[a]); }
    if (j.frames) S.P.frames = Math.max(1, j.frames | 0);
    if (j.fps) S.P.fps = Math.max(1, j.fps | 0);
    if (S.frame === 0) S.frame = 1;
    changed(true); toast('Animation applied');
  }

  /* ---------------------------------------------------------- commands */
  function setTool(t) { S.tool = t; refreshTimelineBar(); draw(); }
  const CMD = {
    new: () => { if (!confirm('Start a new empty project? Unsaved changes are lost (autosave keeps the last one).')) return; loadProject(RK.newProject(), 'New project'); S.frame = 0; draw(); },
    open: () => { $('#fileProject').value = ''; $('#fileProject').click(); },
    save: () => { download(fileName('.rig.json'), JSON.stringify(S.P, null, 1), 'application/json'); toast('Saved project JSON'); },
    demo: () => loadProject(RK.buildDemo(), 'Demo rig loaded: press Space to play'),
    undo, redo, exportHTML, exportWebM, exportPNG,
    aiBrief: () => {
      const t = rigBrief();
      if (navigator.clipboard) navigator.clipboard.writeText(t).then(() => toast('Rig brief copied'), () => { });
      modal('Rig brief for an AI assistant', 'Paste this into Claude (or any assistant) with your shot description, e.g. "make Pip wave twice and laugh". Paste the JSON reply back with <b>Paste anim JSON</b>.', t, [['Close', () => { }]]);
    },
    aiPaste: () => modal('Paste animation JSON', 'Accepts <code>{"anim":{…}}</code>, <code>{"actions":{…}}</code> or a full project. Merge adds keys; Replace clears existing timeline keys first.', '', [['Cancel', () => { }], ['Replace', v => pasteAnim(v, true)], ['Merge', v => pasteAnim(v, false)]]),
    addImages: () => { $('#fileImages').value = ''; $('#fileImages').click(); },
    addSwitch: () => { $('#fileSwitch').value = ''; $('#fileSwitch').click(); },
    addGroup, addStack: () => { $('#fileStack').value = ''; $('#fileStack').click(); },
    exitAction,
    first: () => setFrame(S.action ? 0 : (S.frame === 1 ? 0 : 1)), last: () => setFrame(S.P.frames),
    prev: () => setFrame(S.frame - 1), next: () => setFrame(S.frame + 1),
    play: togglePlay, keyAll, deleteKey: deleteSelKey,
    help: () => modal('Shortcuts and workflow', `<div class="help"><table>
      <tr><td><b>V</b></td><td>Select / rotate bone (drag a bone). Drag art on frame 0 to place it.</td></tr>
      <tr><td><b>T</b></td><td>Translate bone</td></tr><tr><td><b>I</b></td><td>IK drag: pull a bone tip, parents follow (chain length in the left panel)</td></tr>
      <tr><td><b>B</b></td><td>Add bone (frame 0). Drag from joint to tip. Child of the selected bone.</td></tr>
      <tr><td><b>H</b> / Alt+drag / middle mouse</td><td>Pan. Mouse wheel zooms. <b>F</b> fits the stage.</td></tr>
      <tr><td><b>Space</b></td><td>Play / pause</td></tr><tr><td><b>,</b> <b>.</b></td><td>Previous / next frame. <b>Home</b> / <b>End</b>.</td></tr>
      <tr><td><b>K</b></td><td>Key selection at this frame</td></tr><tr><td><b>Delete</b></td><td>Delete selected key (or bone / layer if no key selected)</td></tr>
      <tr><td><b>O</b></td><td>Onion skin</td></tr><tr><td><b>Ctrl+Z</b> / <b>Ctrl+Shift+Z</b></td><td>Undo / redo</td></tr></table>
      <p><b>Moho-style rules.</b> Frame 0 is setup: moving bones there changes the rest pose and does not drag bound art. Frame 1+ is animation: any pose change auto-keys.
      <b>Smart bones</b>: tick "this bone is a dial", press Edit action, set the dial in the timeline, then pose other bones or pick drawings. Rotating the dial later replays those corrections.
      <b>Mesh binding</b> bends one image across several bones (arms, tails, antennas). <b>Switch layers</b> swap drawings with stepped keys.</p></div>`, null, [['Close', () => { }]])
  };
  $$('[data-cmd]').forEach(b => b.addEventListener('click', () => CMD[b.dataset.cmd] && CMD[b.dataset.cmd]()));
  $$('[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));

  $('#fileImages').addEventListener('change', e => addImageLayers(e.target.files, false));
  $('#fileSwitch').addEventListener('change', e => addImageLayers(e.target.files, true));
  $('#fileStack').addEventListener('change', e => addPartStacks(e.target.files));
  $('#fileDrawing').addEventListener('change', e => addDrawings(e.target.dataset.layer, e.target.files));
  $('#fileProject').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader(); r.onload = () => { try { loadProject(JSON.parse(r.result), 'Opened ' + f.name); } catch (err) { toast('Could not read: ' + err.message); } }; r.readAsText(f);
  });

  $('#frameInput').addEventListener('change', e => setFrame(parseInt(e.target.value) || 0));
  $('#framesInput').addEventListener('change', e => { checkpoint(); S.P.frames = Math.max(1, parseInt(e.target.value) || 1); if (S.frame > S.P.frames) S.frame = S.P.frames; changed(); });
  $('#fpsInput').addEventListener('change', e => { checkpoint(); S.P.fps = Math.max(1, Math.min(120, parseInt(e.target.value) || 24)); changed(); });
  $('#loopChk').addEventListener('change', e => S.loop = e.target.checked);
  $('#onionChk').addEventListener('change', e => { S.onion = e.target.checked; draw(); });
  $('#dynChk').addEventListener('change', e => { S.dynamics = e.target.checked; S.sim.reset(); draw(); });
  $('#bonesChk').addEventListener('change', e => { S.showBones = e.target.checked; draw(); });

  // drag and drop images
  const wrap = $('#stageWrap');
  wrap.addEventListener('dragover', e => { e.preventDefault(); wrap.classList.add('drag'); });
  wrap.addEventListener('dragleave', () => wrap.classList.remove('drag'));
  wrap.addEventListener('drop', e => {
    e.preventDefault(); wrap.classList.remove('drag');
    const files = e.dataTransfer.files;
    if (files.length === 1 && /json$/i.test(files[0].name)) { const r = new FileReader(); r.onload = () => { try { loadProject(JSON.parse(r.result), 'Opened'); } catch (err) { toast(err.message); } }; r.readAsText(files[0]); return; }
    addImageLayers(files, false);
  });

  window.addEventListener('keydown', e => {
    if (!$('#modal').hidden) { if (e.key === 'Escape') $('#modal').hidden = true; return; }
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); return redo(); }
    if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); return CMD.save(); }
    if (e.ctrlKey || e.metaKey) return;
    if (k === ' ') { e.preventDefault(); return togglePlay(); }
    if (k === 'v') setTool('select'); else if (k === 't') setTool('translate'); else if (k === 'i') setTool('ik');
    else if (k === 'b') setTool('bone'); else if (k === 'h') setTool('hand');
    else if (k === ',') CMD.prev(); else if (k === '.') CMD.next();
    else if (k === 'home') CMD.first(); else if (k === 'end') CMD.last();
    else if (k === 'k') keyAll(); else if (k === 'f') fitView();
    else if (k === 'o') { S.onion = !S.onion; $('#onionChk').checked = S.onion; draw(); }
    else if (k === 'escape') { if (S.action) exitAction(); else select(null); }
    else if (k === 'delete' || k === 'backspace') {
      if (S.selKey) deleteSelKey();
      else if (S.sel && S.sel.type === 'bone') deleteBone(S.sel.id);
      else if (S.sel && S.sel.type === 'layer') {
        const sl = layerById(S.sel.id);
        if (RK.isGroup(sl)) ungroup(sl.id, false);
        else { checkpoint(); const id = S.sel.id; S.P.layers = S.P.layers.filter(l => l.id !== id); changed(true); }
      }
    }
  });

  window.addEventListener('resize', resize);

  /* -------------------------------------------------------------- boot */
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('ai-rigging-autosave') || 'null'); } catch (e) { saved = null; }
  resize();
  if (saved && saved.bones) loadProject(saved, 'Restored your last session'); else loadProject(RK.buildDemo(), 'Demo rig loaded: press Space to play');
  window.AIRigging = { state: S, cmd: CMD, pasteAnim, rigBrief }; // handy for console and automation
})();
