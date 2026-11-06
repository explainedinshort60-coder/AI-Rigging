/*
 * AI Rigging engine (runtime)
 * Moho-style 2D cutout rigging for the browser: bones, FK, smart bone actions,
 * switch layers, mesh (skinned) image layers, bone dynamics, keyframe easing.
 *
 * No dependencies. Works as a classic <script>. Exposes window.RigKit.
 * The whole engine lives inside RigKitEngine() so the editor can inline its own
 * source into exported standalone HTML players (RigKitEngine.toString()).
 *
 * Conventions
 *  - Units: pixels and DEGREES. Angle 0 points right (+x), positive angles turn
 *    clockwise on screen (canvas y points down).
 *  - Frame 0 is the setup (rest) pose, like Moho. Animation plays from frame 1.
 *  - Bone channels: a (deg, added to rest), x / y (px, added to rest, parent space),
 *    sx / sy (scale multipliers, default 1). sx stretches along the bone.
 *  - Layer channels: switch (drawing index, stepped), opacity (multiplier).
 *  - Key format: [frame, value, ease?]. Ease applies to the segment AFTER the key.
 */
function RigKitEngine(global) {
  'use strict';
  const RK = {};
  RK.VERSION = '0.1.0';
  const DEG = Math.PI / 180;

  /* ------------------------------------------------------------------ math */
  // Affine matrix [a,b,c,d,e,f] in canvas order: x' = a*x + c*y + e, y' = b*x + d*y + f
  const M = {
    ident: () => [1, 0, 0, 1, 0, 0],
    mul(m, n) {
      return [
        m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
        m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
        m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]
      ];
    },
    inv(m) {
      const det = m[0] * m[3] - m[1] * m[2];
      if (!det) return M.ident();
      const id = 1 / det;
      return [m[3] * id, -m[1] * id, -m[2] * id, m[0] * id,
        (m[2] * m[5] - m[3] * m[4]) * id, (m[1] * m[4] - m[0] * m[5]) * id];
    },
    apply(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; },
    trs(x, y, aDeg, sx, sy) {
      const c = Math.cos(aDeg * DEG), s = Math.sin(aDeg * DEG);
      return [c * sx, s * sx, -s * sy, c * sy, x, y];
    },
    angle(m) { return Math.atan2(m[1], m[0]) / DEG; }
  };
  RK.M = M;

  function normDeg(a) { a = (a + 180) % 360; if (a < 0) a += 360; return a - 180; }
  RK.normDeg = normDeg;

  function distToSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + t * dx - px, qy = ay + t * dy - py;
    return Math.sqrt(qx * qx + qy * qy);
  }
  RK.distToSeg = distToSeg;

  /* ---------------------------------------------------------------- easing */
  RK.EASES = {
    linear: [0, 0, 1, 1],
    smooth: [0.42, 0, 0.58, 1],
    'ease-in': [0.42, 0, 1, 1],
    'ease-out': [0, 0, 0.58, 1],
    'fast-out': [0.1, 0.7, 0.3, 1],     // snappy start, long settle
    overshoot: [0.34, 1.56, 0.64, 1],   // passes the target then settles
    anticipate: [0.36, 0, 0.66, -0.56], // pulls back before going
    step: null
  };
  RK.EASE_NAMES = Object.keys(RK.EASES);

  function bezier(x1, y1, x2, y2, x) {
    // Solve cubic-bezier(x1,y1,x2,y2) for y at x (same curve as CSS).
    if (x <= 0) return 0; if (x >= 1) return 1;
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sx = t => ((ax * t + bx) * t + cx) * t;
    const dsx = t => (3 * ax * t + 2 * bx) * t + cx;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sx(t) - x; if (Math.abs(err) < 1e-6) break;
      const d = dsx(t); if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    if (t < 0 || t > 1 || Math.abs(sx(t) - x) > 1e-4) { // bisection fallback
      let lo = 0, hi = 1; t = x;
      for (let i = 0; i < 40; i++) { const v = sx(t); if (Math.abs(v - x) < 1e-6) break; if (v < x) lo = t; else hi = t; t = (lo + hi) / 2; }
    }
    return ((ay * t + by) * t + cy) * t;
  }
  RK.bezier = bezier;

  function easeValue(ease, t) {
    if (ease === 'step') return 0;
    const c = Array.isArray(ease) ? ease : (RK.EASES[ease || 'smooth'] || RK.EASES.smooth);
    return bezier(c[0], c[1], c[2], c[3], t);
  }
  RK.easeValue = easeValue;

  /* ---------------------------------------------------------------- tracks */
  // keys: array of [f, v, ease], kept sorted by f
  function sampleTrack(keys, f, stepped) {
    if (!keys || !keys.length) return undefined;
    if (f <= keys[0][0]) return keys[0][1];
    const last = keys[keys.length - 1];
    if (f >= last[0]) return last[1];
    let i = 0;
    while (i < keys.length - 1 && keys[i + 1][0] <= f) i++;
    const k0 = keys[i], k1 = keys[i + 1];
    const ease = k0[2] || 'smooth';
    if (stepped || ease === 'step') return k0[1];
    const t = (f - k0[0]) / (k1[0] - k0[0]);
    return k0[1] + (k1[1] - k0[1]) * easeValue(ease, t);
  }
  RK.sampleTrack = sampleTrack;

  function setKey(keys, f, v, ease) {
    const i = keys.findIndex(k => k[0] === f);
    if (i >= 0) { keys[i][1] = v; if (ease !== undefined) keys[i][2] = ease; return keys[i]; }
    const k = [f, v, ease === undefined ? 'smooth' : ease];
    keys.push(k); keys.sort((a, b) => a[0] - b[0]);
    return k;
  }
  RK.setKey = setKey;

  RK.BONE_CHANNELS = ['a', 'x', 'y', 'sx', 'sy'];
  RK.LAYER_CHANNELS = ['switch', 'opacity', 'z'];
  const MULT = { sx: 1, sy: 1, opacity: 1 };
  RK.isMult = ch => !!MULT[ch];
  RK.channelDefault = ch => (MULT[ch] ? 1 : 0);

  function trackOf(store, kind, id, ch, create) {
    if (!store) return null;
    if (!store[kind]) { if (!create) return null; store[kind] = {}; }
    if (!store[kind][id]) { if (!create) return null; store[kind][id] = {}; }
    if (!store[kind][id][ch]) { if (!create) return null; store[kind][id][ch] = []; }
    return store[kind][id][ch];
  }
  RK.trackOf = trackOf;

  /* ---------------------------------------------------------------- project */
  RK.newProject = function (opts) {
    opts = opts || {};
    return {
      format: 'ai-rigging', version: 1,
      name: opts.name || 'Untitled',
      width: opts.width || 1280, height: opts.height || 720,
      fps: opts.fps || 24, frames: opts.frames || 48,
      background: opts.background || '#ffffff',
      bones: [], layers: [], assets: {},
      anim: { bones: {}, layers: {} },
      actions: {}
    };
  };

  // Parents before children (FK needs it). Returns a new ordered array.
  RK.sortBones = function (bones) {
    const byId = {}; bones.forEach(b => byId[b.id] = b);
    const out = [], seen = {};
    function visit(b, depth) {
      if (seen[b.id] || depth > 256) return;
      if (b.parent && byId[b.parent]) visit(byId[b.parent], depth + 1);
      if (!seen[b.id]) { seen[b.id] = 1; out.push(b); }
    }
    bones.forEach(b => visit(b, 0));
    return out;
  };

  function orderedBones(project) {
    // cache order by a cheap signature
    const sig = project.bones.map(b => b.id + '<' + (b.parent || '')).join('|');
    if (project.__orderSig !== sig) {
      Object.defineProperty(project, '__orderSig', { value: sig, writable: true, configurable: true });
      Object.defineProperty(project, '__order', { value: RK.sortBones(project.bones), writable: true, configurable: true });
    }
    return project.__order;
  }

  RK.computeWorld = function (project, locals) {
    const world = {};
    for (const b of orderedBones(project)) {
      const L = locals[b.id];
      const m = M.trs(L.x, L.y, L.a, L.sx, L.sy);
      world[b.id] = (b.parent && world[b.parent]) ? M.mul(world[b.parent], m) : m;
    }
    return world;
  };

  RK.restLocals = function (project) {
    const L = {};
    for (const b of project.bones) L[b.id] = { x: b.x || 0, y: b.y || 0, a: b.angle || 0, sx: 1, sy: 1 };
    return L;
  };

  function applyStore(project, store, f, locals, layerState, onlyLayersWhen) {
    const bs = store && store.bones;
    if (bs) for (const id in bs) {
      const L = locals[id]; if (!L) continue;
      const chans = bs[id];
      for (const ch in chans) {
        const v = sampleTrack(chans[ch], f);
        if (v === undefined) continue;
        if (MULT[ch]) L[ch] *= v; else L[ch] += v;
      }
    }
    const ls = store && store.layers;
    if (ls && onlyLayersWhen !== false) for (const id in ls) {
      const st = layerState[id]; if (!st) continue;
      const chans = ls[id];
      if (chans.switch && chans.switch.length) st.switch = Math.round(sampleTrack(chans.switch, f, true));
      if (chans.opacity && chans.opacity.length) st.opacity *= sampleTrack(chans.opacity, f);
      if (chans.z && chans.z.length) st.z = sampleTrack(chans.z, f, true);
    }
  }

  /*
   * evaluate(project, frame, opts) -> pose
   * opts.action = { bone, dial }   preview a smart bone action at a dial value (frame ignored)
   * opts.dynamics + opts.sim       apply bone dynamics (Simulator instance)
   */
  RK.evaluate = function (project, frame, opts) {
    opts = opts || {};
    const locals = RK.restLocals(project);
    const layerState = {};
    for (const l of project.layers) layerState[l.id] = { switch: l.active || 0, opacity: l.opacity == null ? 1 : l.opacity, z: 0 };

    const animFrame = opts.action ? 0 : frame;
    if (animFrame >= 1) applyStore(project, project.anim, animFrame, locals, layerState);

    // Smart bones: the dial is the smart bone's own animated angle offset (degrees).
    const dials = {};
    for (const b of project.bones) {
      if (!b.smart) continue;
      let dial = locals[b.id].a - (b.angle || 0);
      if (opts.action && opts.action.bone === b.id) { dial = opts.action.dial; locals[b.id].a = (b.angle || 0) + dial; }
      dials[b.id] = dial;
    }
    for (const id in dials) {
      const act = project.actions && project.actions[id];
      if (!act) continue;
      const dial = dials[id];
      applyStore(project, act, dial, locals, layerState, Math.abs(dial) > 0.5);
    }

    // constraints (absolute local angle range, degrees)
    for (const b of project.bones) {
      if (b.constraint && b.constraint.enabled) {
        const L = locals[b.id];
        L.a = Math.max(b.constraint.min, Math.min(b.constraint.max, L.a));
      }
    }

    let world = RK.computeWorld(project, locals);
    if (opts.dynamics && opts.sim && frame >= 1 && !opts.action) {
      const offs = opts.sim.offsets(project, frame);
      if (offs) {
        for (const id in offs) if (locals[id]) locals[id].a += offs[id];
        world = RK.computeWorld(project, locals);
      }
    }
    const rest = RK.computeWorld(project, RK.restLocals(project));
    return { frame, locals, world, rest, layers: layerState, dials };
  };

  RK.boneTip = function (project, pose, b) {
    return M.apply(pose.world[b.id], b.length || 0, 0);
  };

  /* -------------------------------------------------------------- dynamics */
  // Bone dynamics: the bone tip is a damped spring particle chasing its animated
  // tip. The lag becomes an angle offset, so antennas, tails and ears swing.
  RK.Simulator = class {
    constructor() { this.reset(); }
    reset() { this.cache = []; this.proj = null; }
    offsets(project, frame) {
      const dyn = project.bones.filter(b => b.dynamics && b.dynamics.enabled);
      if (!dyn.length) return null;
      if (this.proj !== project) { this.cache = []; this.proj = project; }
      frame = Math.floor(frame);
      if (this.cache[frame]) return this.cache[frame].offs;
      let f0 = frame; while (f0 > 0 && !this.cache[f0]) f0--;
      for (let f = Math.max(1, f0 + 1); f <= frame; f++) {
        const pose = RK.evaluate(project, f, {});
        const prev = this.cache[f - 1];
        const states = {}, offs = {};
        for (const b of dyn) {
          const w = pose.world[b.id];
          const base = M.apply(w, 0, 0), tip = M.apply(w, b.length || 1, 0);
          let s = prev && prev.states[b.id];
          s = s ? { px: s.px, py: s.py, vx: s.vx, vy: s.vy } : { px: tip[0], py: tip[1], vx: 0, vy: 0 };
          const k = b.dynamics.stiffness == null ? 0.18 : b.dynamics.stiffness;
          const d = b.dynamics.damping == null ? 0.18 : b.dynamics.damping;
          const g = b.dynamics.gravity || 0;
          for (let i = 0; i < 2; i++) {
            s.vx += (tip[0] - s.px) * k; s.vy += (tip[1] - s.py) * k + g;
            s.vx *= (1 - d); s.vy *= (1 - d);
            s.px += s.vx; s.py += s.vy;
            const dx = s.px - base[0], dy = s.py - base[1];
            const len = Math.hypot(dx, dy) || 1, want = Math.hypot(tip[0] - base[0], tip[1] - base[1]);
            s.px = base[0] + dx / len * want; s.py = base[1] + dy / len * want;
          }
          states[b.id] = s;
          let off = normDeg(Math.atan2(s.py - base[1], s.px - base[0]) / DEG - Math.atan2(tip[1] - base[1], tip[0] - base[0]) / DEG);
          const lim = b.dynamics.limit == null ? 80 : b.dynamics.limit;
          offs[b.id] = Math.max(-lim, Math.min(lim, off));
        }
        this.cache[f] = { states, offs };
      }
      return this.cache[frame] ? this.cache[frame].offs : null;
    }
  };

  /* ------------------------------------------------------------------ mesh */
  const meshCache = new WeakMap();
  RK.layerBones = function (layer) {
    if (layer.bind === 'mesh' && layer.bones && layer.bones.length) return layer.bones;
    return layer.bone ? [layer.bone] : [];
  };

  RK.meshData = function (project, layer, rest) {
    const cols = Math.max(1, (layer.mesh && layer.mesh.cols) || 4);
    const rows = Math.max(1, (layer.mesh && layer.mesh.rows) || 4);
    const ids = RK.layerBones(layer).filter(id => rest[id]);
    const bonesById = {}; project.bones.forEach(b => bonesById[b.id] = b);
    const sig = JSON.stringify([layer.x, layer.y, layer.w, layer.h, cols, rows, ids, !!layer.flipX, !!layer.flipY, layer.mesh && layer.mesh.falloff,
      ids.map(id => [rest[id], bonesById[id] && bonesById[id].length, bonesById[id] && bonesById[id].strength])]);
    const hit = meshCache.get(layer);
    if (hit && hit.sig === sig) return hit.data;
    const verts = [], uvs = [], weights = [], tris = [];
    // falloff: lower = softer blend across joints (fewer folds), higher = stiffer, more rigid segments
    const falloff = (layer.mesh && layer.mesh.falloff) || 2.5;
    const segs = ids.map(id => {
      const b = bonesById[id];
      const a = M.apply(rest[id], 0, 0), t = M.apply(rest[id], b.length || 0, 0);
      return { a, t, s: b.strength || Math.max(8, (b.length || 20) * 0.6) };
    });
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
      const u = i / cols, v = j / rows;
      const x = layer.x + layer.w * u, y = layer.y + layer.h * v;
      verts.push(x, y); uvs.push(layer.flipX ? 1 - u : u, layer.flipY ? 1 - v : v);
      let ws = segs.map(sg => 1 / (1e-6 + Math.pow(distToSeg(x, y, sg.a[0], sg.a[1], sg.t[0], sg.t[1]) / sg.s, falloff)));
      const sum = ws.reduce((p, c) => p + c, 0) || 1;
      weights.push(ws.map(w => w / sum));
    }
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
      tris.push(a, b, d, a, d, c);
    }
    const data = { cols, rows, ids, verts, uvs, weights, tris };
    meshCache.set(layer, { sig, data });
    return data;
  };

  RK.boneDelta = function (pose, id) {
    if (!id || !pose.world[id]) return M.ident();
    return M.mul(pose.world[id], M.inv(pose.rest[id]));
  };

  // Deformed vertex positions for a mesh layer (world space)
  RK.deformMesh = function (project, layer, pose) {
    const md = RK.meshData(project, layer, pose.rest);
    const deltas = md.ids.map(id => RK.boneDelta(pose, id));
    const out = new Array(md.verts.length);
    for (let i = 0, n = md.verts.length / 2; i < n; i++) {
      const x = md.verts[i * 2], y = md.verts[i * 2 + 1];
      if (!deltas.length) { out[i * 2] = x; out[i * 2 + 1] = y; continue; }
      let ox = 0, oy = 0;
      const w = md.weights[i];
      for (let k = 0; k < deltas.length; k++) {
        if (w[k] < 1e-4) continue;
        const p = M.apply(deltas[k], x, y); ox += p[0] * w[k]; oy += p[1] * w[k];
      }
      out[i * 2] = ox; out[i * 2 + 1] = oy;
    }
    return { md, pts: out };
  };

  /* ---------------------------------------------------------------- render */
  RK.layerDrawing = function (layer, pose) {
    const n = (layer.drawings || []).length; if (!n) return null;
    let idx = pose.layers[layer.id] ? pose.layers[layer.id].switch : (layer.active || 0);
    idx = Math.max(0, Math.min(n - 1, idx | 0));
    return layer.drawings[idx];
  };

  function drawTri(ctx, img, iw, ih, s, d, e) {
    // s, d: [x0,y0,x1,y1,x2,y2] source (image px) and destination (current space)
    const Ms = [s[2] - s[0], s[3] - s[1], s[4] - s[0], s[5] - s[1], s[0], s[1]];
    const Md = [d[2] - d[0], d[3] - d[1], d[4] - d[0], d[5] - d[1], d[0], d[1]];
    const A = M.mul(Md, M.inv(Ms));
    // Grow the clip triangle so every EDGE moves outward by e (scale about the incenter).
    // This hides anti-aliasing seams between neighbouring triangles, even thin ones.
    const la = Math.hypot(d[2] - d[4], d[3] - d[5]), lb = Math.hypot(d[0] - d[4], d[1] - d[5]), lc = Math.hypot(d[0] - d[2], d[1] - d[3]);
    const per = la + lb + lc || 1;
    const ix = (la * d[0] + lb * d[2] + lc * d[4]) / per, iy = (la * d[1] + lb * d[3] + lc * d[5]) / per;
    const area = Math.abs((d[2] - d[0]) * (d[5] - d[1]) - (d[4] - d[0]) * (d[3] - d[1])) / 2;
    const r = (2 * area) / per;
    const k = r > 1e-6 ? Math.min(4, (r + e) / r) : 1;
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const px = ix + (d[i * 2] - ix) * k, py = iy + (d[i * 2 + 1] - iy) * k;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath(); ctx.clip();
    ctx.transform(A[0], A[1], A[2], A[3], A[4], A[5]);
    const minx = Math.max(0, Math.floor(Math.min(s[0], s[2], s[4]) - 2));
    const miny = Math.max(0, Math.floor(Math.min(s[1], s[3], s[5]) - 2));
    const maxx = Math.min(iw, Math.ceil(Math.max(s[0], s[2], s[4]) + 2));
    const maxy = Math.min(ih, Math.ceil(Math.max(s[1], s[3], s[5]) + 2));
    if (maxx > minx && maxy > miny) ctx.drawImage(img, minx, miny, maxx - minx, maxy - miny, minx, miny, maxx - minx, maxy - miny);
    ctx.restore();
  }

  /*
   * render(ctx, project, pose, images, opts)
   * opts.view: matrix applied first (editor pan/zoom, device pixel ratio)
   * opts.background: true to fill the stage with project.background
   * opts.alpha: global alpha multiplier (onion skins)
   */
  RK.render = function (ctx, project, pose, images, opts) {
    opts = opts || {};
    const view = opts.view || M.ident();
    const ga = opts.alpha == null ? 1 : opts.alpha;
    ctx.save();
    ctx.setTransform(view[0], view[1], view[2], view[3], view[4], view[5]);
    if (opts.background) { ctx.fillStyle = project.background || '#fff'; ctx.fillRect(0, 0, project.width, project.height); }
    // draw order: array index plus the keyed z offset (stepped), so parts can swap in front / behind
    const order = project.layers.map((l, i) => [i + ((pose.layers[l.id] && pose.layers[l.id].z) || 0) + i * 1e-6, l]).sort((a, b) => a[0] - b[0]).map(e => e[1]);
    for (const layer of order) {
      if (layer.hidden) continue;
      const dr = RK.layerDrawing(layer, pose); if (!dr) continue;
      const img = images[dr.asset];
      if (!img || !(img.complete === undefined || img.complete) || !(img.naturalWidth || img.width)) continue;
      const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
      const st = pose.layers[layer.id];
      ctx.globalAlpha = ga * (st ? st.opacity : 1);
      if (ctx.globalAlpha <= 0.001) continue;
      if (layer.bind === 'mesh' && RK.layerBones(layer).length) {
        const { md, pts } = RK.deformMesh(project, layer, pose);
        ctx.setTransform(view[0], view[1], view[2], view[3], view[4], view[5]);
        const grow = 0.9 / (Math.sqrt(Math.abs(view[0] * view[3] - view[1] * view[2])) || 1);
        for (let t = 0; t < md.tris.length; t += 3) {
          const i0 = md.tris[t], i1 = md.tris[t + 1], i2 = md.tris[t + 2];
          drawTri(ctx, img, iw, ih,
            [md.uvs[i0 * 2] * iw, md.uvs[i0 * 2 + 1] * ih, md.uvs[i1 * 2] * iw, md.uvs[i1 * 2 + 1] * ih, md.uvs[i2 * 2] * iw, md.uvs[i2 * 2 + 1] * ih],
            [pts[i0 * 2], pts[i0 * 2 + 1], pts[i1 * 2], pts[i1 * 2 + 1], pts[i2 * 2], pts[i2 * 2 + 1]], grow);
        }
      } else {
        const m = M.mul(view, RK.boneDelta(pose, layer.bone));
        ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
        if (layer.flipX || layer.flipY) {
          ctx.translate(layer.x + (layer.flipX ? layer.w : 0), layer.y + (layer.flipY ? layer.h : 0));
          ctx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);
          ctx.drawImage(img, 0, 0, layer.w, layer.h);
        } else ctx.drawImage(img, layer.x, layer.y, layer.w, layer.h);
      }
    }
    ctx.restore();
  };

  RK.loadImages = function (project) {
    const images = {};
    const jobs = Object.keys(project.assets || {}).map(id => new Promise(res => {
      const img = new Image();
      img.onload = () => res(); img.onerror = () => res();
      img.src = project.assets[id];
      images[id] = img;
    }));
    return Promise.all(jobs).then(() => images);
  };

  /* ---------------------------------------------------------------- player */
  RK.Player = class {
    constructor(canvas, project, opts) {
      this.canvas = canvas; this.project = project; this.opts = Object.assign({ loop: true, autoplay: true, scale: 1 }, opts || {});
      this.sim = new RK.Simulator(); this.frame = project.frames >= 1 ? 1 : 0; this.playing = false;
      const s = this.opts.scale;
      canvas.width = project.width * s; canvas.height = project.height * s;
      this.ctx = canvas.getContext('2d');
      this.ready = RK.loadImages(project).then(imgs => { this.images = imgs; this.draw(); if (this.opts.autoplay) this.play(); });
    }
    draw() {
      if (!this.images) return;
      const s = this.opts.scale;
      const pose = RK.evaluate(this.project, this.frame, { dynamics: true, sim: this.sim });
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      RK.render(this.ctx, this.project, pose, this.images, { view: [s, 0, 0, s, 0, 0], background: true });
    }
    seek(f) { this.frame = f; this.draw(); }
    play() {
      if (this.playing || this.project.frames < 1) return;
      this.playing = true; let last = performance.now(), acc = 0;
      const step = now => {
        if (!this.playing) return;
        acc += now - last; last = now;
        const spf = 1000 / (this.project.fps || 24);
        let advanced = false;
        while (acc >= spf) {
          acc -= spf; advanced = true;
          this.frame++;
          if (this.frame > this.project.frames) {
            if (this.opts.loop) this.frame = 1; else { this.frame = this.project.frames; this.playing = false; }
          }
        }
        if (advanced) this.draw();
        if (this.playing) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
    pause() { this.playing = false; }
  };

  global.RigKit = RK;
  return RK;
}
if (typeof window !== 'undefined') RigKitEngine(window);
else if (typeof module !== 'undefined') module.exports = RigKitEngine({});
