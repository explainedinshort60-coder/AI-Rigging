/*
 * Demo rig: "Pip", a small round robot-blob.
 * Shows every feature: rigid binding, mesh binding (bendy arms and antenna),
 * switch layers (eyes, mouth), a smart bone dial ("smile") that drives the
 * mouth switch and a head tilt, bone dynamics on the antenna, and squash.
 * The head and body are part stacks (colour, screen-locked paper grain, multiply shadow,
 * screen highlight, line) inside groups, so they show the layer system.
 * All art is generated SVG so the repo ships with no binary assets.
 */
(function (global) {
  'use strict';
  const RK = global.RigKit;

  function svgURL(w, h, body) {
    const s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
  }

  const INK = '#2b2340', SKIN = '#7fd1c7', SKIN2 = '#5fb3a9', CHEEK = '#ff9db0', ACC = '#ffb547';

  const ART = {
    // BODY part stack
    bodyColor: svgURL(150, 170, `<path d="M75 6 C128 6 144 60 144 105 C144 148 116 164 75 164 C34 164 6 148 6 105 C6 60 22 6 75 6Z" fill="${SKIN}"/>
      <ellipse cx="75" cy="112" rx="40" ry="34" fill="#c9f1ea"/>`),
    bodyShadow: svgURL(150, 170, `<path d="M150 50 C140 140 100 170 30 170 L150 170Z" fill="#9db8d6"/>`),
    bodyHighlight: svgURL(150, 170, `<ellipse cx="46" cy="42" rx="22" ry="12" transform="rotate(-30 46 42)" fill="#8a8a8a"/>`),
    bodyLine: svgURL(150, 170, `<path d="M75 6 C128 6 144 60 144 105 C144 148 116 164 75 164 C34 164 6 148 6 105 C6 60 22 6 75 6Z" fill="none" stroke="${INK}" stroke-width="6"/>
      <circle cx="75" cy="104" r="9" fill="${ACC}" stroke="${INK}" stroke-width="4"/>`),
    headColor: svgURL(164, 150, `<rect x="6" y="6" width="152" height="138" rx="62" fill="${SKIN}"/>`),
    headShadow: svgURL(164, 150, `<path d="M164 40 C150 120 90 150 20 150 L164 150Z" fill="#9db8d6"/><path d="M0 128 Q60 156 150 112 L164 150 L0 150Z" fill="#9db8d6"/>`),
    headHighlight: svgURL(164, 150, `<ellipse cx="54" cy="36" rx="34" ry="16" transform="rotate(-18 54 36)" fill="#8a8a8a"/>`),
    headLine: svgURL(164, 150, `<rect x="6" y="6" width="152" height="138" rx="62" fill="none" stroke="${INK}" stroke-width="6"/>
      <ellipse cx="34" cy="98" rx="13" ry="8" fill="${CHEEK}" opacity=".8"/><ellipse cx="130" cy="98" rx="13" ry="8" fill="${CHEEK}" opacity=".8"/>`),
    grain: svgURL(800, 600, `<filter id="n" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" seed="7" stitchTiles="stitch"/>
      <feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncR type="linear" slope="0.45" intercept="0.62"/><feFuncG type="linear" slope="0.45" intercept="0.62"/><feFuncB type="linear" slope="0.45" intercept="0.62"/><feFuncA type="linear" slope="0" intercept="1"/></feComponentTransfer></filter>
      <rect width="800" height="600" filter="url(#n)"/>`),
    eyesOpen: svgURL(90, 40, `<ellipse cx="18" cy="20" rx="11" ry="15" fill="${INK}"/><ellipse cx="72" cy="20" rx="11" ry="15" fill="${INK}"/>
      <circle cx="22" cy="13" r="4" fill="#fff"/><circle cx="76" cy="13" r="4" fill="#fff"/>`),
    eyesClosed: svgURL(90, 40, `<path d="M6 22 Q18 30 30 22" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
      <path d="M60 22 Q72 30 84 22" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`),
    mouthNeutral: svgURL(60, 34, `<path d="M16 16 L44 16" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`),
    mouthSmile: svgURL(60, 34, `<path d="M10 10 Q30 30 50 10" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`),
    mouthLaugh: svgURL(60, 34, `<path d="M8 6 Q30 4 52 6 Q48 30 30 30 Q12 30 8 6Z" fill="#7a2a3a" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
      <path d="M18 22 Q30 16 42 22 Q36 29 30 29 Q24 29 18 22Z" fill="${CHEEK}"/>`),
    antenna: svgURL(20, 90, `<rect x="7" y="16" width="6" height="74" rx="3" fill="${INK}"/><circle cx="10" cy="10" r="8" fill="${ACC}" stroke="${INK}" stroke-width="3"/>`),
    armL: svgURL(128, 32, `<rect x="20" y="8" width="104" height="16" rx="8" fill="${SKIN2}" stroke="${INK}" stroke-width="4"/><circle cx="16" cy="16" r="13" fill="${SKIN}" stroke="${INK}" stroke-width="4"/>`),
    armR: svgURL(128, 32, `<rect x="4" y="8" width="104" height="16" rx="8" fill="${SKIN2}" stroke="${INK}" stroke-width="4"/><circle cx="112" cy="16" r="13" fill="${SKIN}" stroke="${INK}" stroke-width="4"/>`),
    leg: svgURL(44, 62, `<rect x="14" y="2" width="16" height="44" rx="7" fill="${SKIN2}" stroke="${INK}" stroke-width="4"/><ellipse cx="22" cy="50" rx="19" ry="10" fill="${INK}"/>`)
  };

  RK.buildDemo = function () {
    const p = RK.newProject({ name: 'Pip demo', width: 800, height: 600, fps: 24, frames: 48, background: '#fff7ea' });
    for (const k in ART) p.assets[k] = ART[k];

    // Bones defined in WORLD rest space, converted to local below.
    const W = [
      { id: 'body', name: 'Body', parent: null, wx: 400, wy: 480, wa: -90, length: 130 },
      { id: 'head', name: 'Head', parent: 'body', wx: 400, wy: 350, wa: -90, length: 120 },
      { id: 'ant1', name: 'Antenna 1', parent: 'head', wx: 400, wy: 240, wa: -90, length: 38, dynamics: { enabled: true, stiffness: 0.16, damping: 0.16 } },
      { id: 'ant2', name: 'Antenna 2', parent: 'ant1', wx: 400, wy: 202, wa: -90, length: 38, dynamics: { enabled: true, stiffness: 0.14, damping: 0.14 } },
      { id: 'armL_up', name: 'Arm L upper', parent: 'body', wx: 350, wy: 380, wa: 180, length: 55, constraint: { enabled: false, min: 60, max: 300 } },
      { id: 'armL_lo', name: 'Arm L lower', parent: 'armL_up', wx: 295, wy: 380, wa: 180, length: 55 },
      { id: 'armR_up', name: 'Arm R upper', parent: 'body', wx: 450, wy: 380, wa: 0, length: 55 },
      { id: 'armR_lo', name: 'Arm R lower', parent: 'armR_up', wx: 505, wy: 380, wa: 0, length: 55 },
      { id: 'legL', name: 'Leg L', parent: null, wx: 380, wy: 470, wa: 90, length: 45 },
      { id: 'legR', name: 'Leg R', parent: null, wx: 420, wy: 470, wa: 90, length: 45 },
      { id: 'smile', name: 'Smile (smart)', parent: 'head', wx: 500, wy: 250, wa: 0, length: 34, smart: { min: 0, max: 90 } }
    ];
    const worldRest = {};
    for (const w of W) {
      const b = { id: w.id, name: w.name, parent: w.parent, length: w.length, x: w.wx, y: w.wy, angle: w.wa };
      if (w.parent) {
        const pm = worldRest[w.parent];
        const inv = RK.M.inv(pm);
        const lp = RK.M.apply(inv, w.wx, w.wy);
        b.x = lp[0]; b.y = lp[1]; b.angle = RK.normDeg(w.wa - RK.M.angle(pm));
      }
      worldRest[w.id] = RK.M.trs(w.wx, w.wy, w.wa, 1, 1);
      if (w.dynamics) b.dynamics = w.dynamics;
      if (w.smart) b.smart = w.smart;
      if (w.constraint) b.constraint = w.constraint;
      p.bones.push(b);
    }

    const L = (o) => Object.assign({ opacity: 1, active: 0, bind: 'rigid', hidden: false, blend: 'normal', bone: null }, o);
    const G = (o) => Object.assign({ type: 'group', drawings: [], opacity: 1, blend: 'normal', hidden: false, group: null }, o);
    p.layers = [
      L({ id: 'legL_art', name: 'Leg L', drawings: [{ name: 'leg', asset: 'leg' }], bone: 'legL', x: 358, y: 462, w: 44, h: 62 }),
      L({ id: 'legR_art', name: 'Leg R', drawings: [{ name: 'leg', asset: 'leg' }], bone: 'legR', x: 398, y: 462, w: 44, h: 62 }),
      L({ id: 'antenna_art', name: 'Antenna', drawings: [{ name: 'antenna', asset: 'antenna' }], bone: 'ant1', bind: 'mesh', bones: ['ant1', 'ant2'], mesh: { cols: 1, rows: 10 }, x: 390, y: 160, w: 20, h: 90 }),
      // Body: a part stack in a group. Children have no bone; they follow the group's bone.
      G({ id: 'body_grp', name: 'Body', bone: 'body' }),
      L({ id: 'body_color', name: 'Body colour', group: 'body_grp', drawings: [{ name: 'colour', asset: 'bodyColor' }], x: 325, y: 330, w: 150, h: 170 }),
      L({ id: 'body_tex', name: 'Body texture', group: 'body_grp', drawings: [{ name: 'grain', asset: 'grain' }], clip: true, blend: 'multiply', screenLock: true, x: 0, y: 0, w: 800, h: 600 }),
      L({ id: 'body_shadow', name: 'Body shadow', group: 'body_grp', drawings: [{ name: 'shadow', asset: 'bodyShadow' }], clip: true, blend: 'multiply', x: 325, y: 330, w: 150, h: 170 }),
      L({ id: 'body_hl', name: 'Body highlight', group: 'body_grp', drawings: [{ name: 'highlight', asset: 'bodyHighlight' }], clip: true, blend: 'screen', opacity: 0.7, x: 325, y: 330, w: 150, h: 170 }),
      L({ id: 'body_line', name: 'Body line', group: 'body_grp', drawings: [{ name: 'line', asset: 'bodyLine' }], x: 325, y: 330, w: 150, h: 170 }),
      // Head: part stack plus face parts, all following the group's bone
      G({ id: 'head_grp', name: 'Head', bone: 'head' }),
      L({ id: 'head_color', name: 'Head colour', group: 'head_grp', drawings: [{ name: 'colour', asset: 'headColor' }], x: 318, y: 212, w: 164, h: 150 }),
      L({ id: 'head_tex', name: 'Head texture', group: 'head_grp', drawings: [{ name: 'grain', asset: 'grain' }], clip: true, blend: 'multiply', screenLock: true, x: 0, y: 0, w: 800, h: 600 }),
      L({ id: 'head_shadow', name: 'Head shadow', group: 'head_grp', drawings: [{ name: 'shadow', asset: 'headShadow' }], clip: true, blend: 'multiply', x: 318, y: 212, w: 164, h: 150 }),
      L({ id: 'head_hl', name: 'Head highlight', group: 'head_grp', drawings: [{ name: 'highlight', asset: 'headHighlight' }], clip: true, blend: 'screen', opacity: 0.7, x: 318, y: 212, w: 164, h: 150 }),
      L({ id: 'head_line', name: 'Head line', group: 'head_grp', drawings: [{ name: 'line', asset: 'headLine' }], x: 318, y: 212, w: 164, h: 150 }),
      L({ id: 'eyes', name: 'Eyes (switch)', group: 'head_grp', drawings: [{ name: 'open', asset: 'eyesOpen' }, { name: 'closed', asset: 'eyesClosed' }], x: 355, y: 258, w: 90, h: 40 }),
      L({ id: 'mouth', name: 'Mouth (switch)', group: 'head_grp', drawings: [{ name: 'neutral', asset: 'mouthNeutral' }, { name: 'smile', asset: 'mouthSmile' }, { name: 'laugh', asset: 'mouthLaugh' }], x: 370, y: 304, w: 60, h: 34 }),
      L({ id: 'armL_art', name: 'Arm L', drawings: [{ name: 'arm', asset: 'armL' }], bone: 'armL_up', bind: 'mesh', bones: ['armL_up', 'armL_lo'], mesh: { cols: 10, rows: 2 }, x: 228, y: 364, w: 128, h: 32 }),
      L({ id: 'armR_art', name: 'Arm R', drawings: [{ name: 'arm', asset: 'armR' }], bone: 'armR_up', bind: 'mesh', bones: ['armR_up', 'armR_lo'], mesh: { cols: 10, rows: 2 }, x: 444, y: 364, w: 128, h: 32 })
    ];

    // Smart bone action: dial 0..90 degrees.
    p.actions.smile = {
      bones: { head: { a: [[0, 0, 'smooth'], [90, -8, 'smooth']] } },
      layers: { mouth: { switch: [[0, 0, 'step'], [25, 1, 'step'], [65, 2, 'step']] } }
    };

    // Animation, frames 1..48, loops (frame 49 key = frame 1 so the cycle closes).
    p.anim = {
      bones: {
        body: {
          y: [[1, 0, 'smooth'], [13, -14, 'smooth'], [25, 0, 'smooth'], [37, -14, 'smooth'], [49, 0]],
          sx: [[1, 0.95, 'fast-out'], [7, 1.04, 'smooth'], [13, 1, 'smooth'], [25, 0.95, 'fast-out'], [31, 1.04, 'smooth'], [37, 1, 'smooth'], [49, 0.95]],
          sy: [[1, 1.05, 'fast-out'], [7, 0.97, 'smooth'], [13, 1, 'smooth'], [25, 1.05, 'fast-out'], [31, 0.97, 'smooth'], [37, 1, 'smooth'], [49, 1.05]],
          a: [[1, 0, 'smooth'], [25, 4, 'smooth'], [49, 0]]
        },
        head: { a: [[1, 0, 'smooth'], [15, 6, 'smooth'], [33, -5, 'smooth'], [49, 0]] },
        armR_up: { a: [[1, -10, 'fast-out'], [9, -62, 'smooth'], [41, -62, 'smooth'], [49, -10]] },
        armR_lo: { a: [[1, 0, 'smooth'], [9, -40, 'smooth'], [15, 10, 'smooth'], [21, -40, 'smooth'], [27, 10, 'smooth'], [33, -40, 'smooth'], [41, -20, 'smooth'], [49, 0]] },
        armL_up: { a: [[1, -62, 'smooth'], [25, -55, 'smooth'], [49, -62]] },
        armL_lo: { a: [[1, -25, 'smooth'], [27, -15, 'smooth'], [49, -25]] },
        smile: { a: [[1, 0, 'smooth'], [8, 0, 'overshoot'], [14, 45, 'smooth'], [30, 45, 'smooth'], [36, 80, 'smooth'], [42, 80, 'smooth'], [48, 0]] }
      },
      layers: {
        eyes: { switch: [[1, 0, 'step'], [20, 1, 'step'], [22, 0, 'step'], [44, 1, 'step'], [46, 0, 'step']] }
      }
    };
    return p;
  };
})(window);
