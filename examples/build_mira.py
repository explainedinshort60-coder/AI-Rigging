#!/usr/bin/env python3
"""
"Mira": an original character built entirely in SVG as cutout parts, then rigged for AI Rigging.

  python3 examples/build_mira.py            -> examples/mira.rig.json  (+ examples/mira-parts/*.svg)

Style: flat colour shapes, no body outlines, thin dark line only on eyes, brows, mouth and glasses,
dry-brush wobble on every edge (feTurbulence displacement) and fine grain, soft blush.
Shape construction notes (SHAPE SPEC):
  curly bob   RapidFireArt "How to Draw Curls" + Hellokids "Curly Hair": curls radiate from the crown,
              thick rounded clumps slanted one way, tapered ends. Ours: scalloped cloud, crown top-left.
  hand        People's Pharmacy "How to Draw a Cartoon Hand": long index finger, others tucked into the palm.
  glasses     SkyRye "How to Draw Glasses" + Gurney "Ten Tips": sit on the nose bridge, follow the face curve,
              round lenses a touch wider than tall, face drawn first.
Every part is drawn in WORLD coordinates (900 x 900 stage) and cropped to its own box, so the rest pose
assembles itself and each part exports as a separate SVG.
"""
import json, math, os, urllib.parse

OUT = os.path.join(os.path.dirname(__file__), 'mira.rig.json')
PARTS_DIR = os.path.join(os.path.dirname(__file__), 'mira-parts')
os.makedirs(PARTS_DIR, exist_ok=True)

C = dict(
    skin='#e9b48e', skin_sh='#cf8f6e', blush='#e46d72', freck='#b06a4f',
    hair='#3a2520', hair_hi='#5b3b2f', hair_dk='#26180f',
    ink='#2a1c19', white='#fbf6ec', iris='#4b3426',
    teal='#2f8c88', cream='#efe1c5', teal_dk='#246f6c',
    mustard='#d9a23b', mustard_dk='#b9832a', petal='#f3c43a', seed='#6b3f1d', lip='#9b3c43', tongue='#e07a7c',
    lens='#cfe6ef',
)

def paint_filter(seed, wobble=2.6, grain=0.20):
    return f'''<filter id="p" x="-6%" y="-6%" width="112%" height="112%" color-interpolation-filters="sRGB">
<feTurbulence type="fractalNoise" baseFrequency="0.032" numOctaves="2" seed="{seed}" result="n"/>
<feDisplacementMap in="SourceGraphic" in2="n" scale="{wobble}" xChannelSelector="R" yChannelSelector="G" result="d"/>
<feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="{seed + 7}" result="g"/>
<feColorMatrix in="g" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -0.45 0 0 0 {grain}" result="ga"/>
<feComposite in="ga" in2="d" operator="in" result="gi"/>
<feMerge><feMergeNode in="d"/><feMergeNode in="gi"/></feMerge></filter>'''

ASSETS, BOXES = {}, {}
def part(name, box, body, seed=3, defs='', wobble=2.6, grain=0.20, filt=True):
    x, y, w, h = box
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="{x} {y} {w} {h}">'
           f'<defs>{paint_filter(seed, wobble, grain) if filt else ""}{defs}</defs>'
           f'<g{" filter=\"url(#p)\"" if filt else ""}>{body}</g></svg>')
    open(os.path.join(PARTS_DIR, name + '.svg'), 'w').write(svg)
    ASSETS[name] = 'data:image/svg+xml;charset=utf-8,' + urllib.parse.quote(svg)
    BOXES[name] = box
    return name

def circles(pts, fill):
    return ''.join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{fill}"/>' for x, y, r in pts)

# ------------------------------------------------------------------ HAIR (back mass)
back_pts = [(455, 200, 118), (372, 225, 62), (538, 222, 64), (340, 280, 58), (575, 278, 60), (332, 345, 54),
            (585, 340, 56), (342, 405, 48), (578, 400, 50), (360, 452, 40), (566, 448, 42), (405, 165, 52),
            (500, 160, 56), (455, 145, 50), (350, 240, 44), (590, 240, 40), (325, 315, 38), (600, 305, 36)]
part('hairBack', (270, 60, 380, 445),
     f'<ellipse cx="456" cy="320" rx="122" ry="150" fill="{C["hair"]}"/>' + circles(back_pts, C['hair']) +
     # curl texture: a few C-shaped clumps slanting the same way (RapidFireArt), lighter brown
     ''.join(f'<path d="M{x} {y} q {r} {-r*0.4} {r*0.6} {r*0.7}" fill="none" stroke="{C["hair_hi"]}" stroke-width="7" stroke-linecap="round"/>'
             for x, y, r in [(345, 270, 26), (360, 340, 22), (565, 260, 24), (575, 330, 22), (420, 150, 26), (500, 140, 24), (350, 410, 18), (560, 405, 18)]),
     seed=11, wobble=3.2)

# ------------------------------------------------------------------ HEAD
face = ('M345 300 C345 212 395 178 455 178 C522 178 566 216 566 300 C566 370 546 420 506 452 '
        'C486 467 469 474 452 474 C424 474 400 462 381 440 C356 410 345 360 345 300 Z')
part('faceColor', (330, 165, 250, 320), f'<path d="{face}" fill="{C["skin"]}"/>', seed=5)
part('faceShade', (330, 165, 250, 320),
     # hair shadow across the brow and a soft jaw-side form shadow (multiply, clipped to the face)
     f'<path d="M340 210 C380 250 430 262 470 255 C520 248 552 232 575 215 L575 165 L330 165 Z" fill="{C["skin_sh"]}" opacity=".85"/>'
     f'<path d="M566 290 C568 370 535 435 478 468 C520 430 548 372 552 300 Z" fill="{C["skin_sh"]}" opacity=".5"/>', seed=6, wobble=4)
part('ear', (318, 292, 46, 66),
     f'<ellipse cx="342" cy="325" rx="17" ry="25" fill="{C["skin"]}"/><path d="M338 312 q 10 6 4 20" fill="none" stroke="{C["skin_sh"]}" stroke-width="5" stroke-linecap="round"/>', seed=8)
part('blush', (360, 355, 200, 75), f'''<ellipse cx="402" cy="393" rx="32" ry="17" fill="url(#bl)"/><ellipse cx="518" cy="388" rx="30" ry="16" fill="url(#bl)"/>
     <ellipse cx="462" cy="382" rx="14" ry="10" fill="url(#bl)"/>''', seed=9, filt=False,
     defs=f'<radialGradient id="bl"><stop offset="0" stop-color="{C["blush"]}" stop-opacity=".75"/><stop offset="1" stop-color="{C["blush"]}" stop-opacity="0"/></radialGradient>')
fr = [(388, 384, 2.4), (398, 396, 2), (412, 388, 2.2), (404, 378, 1.8), (419, 399, 1.7), (505, 380, 2.2), (518, 392, 2), (530, 383, 2.3), (512, 372, 1.7), (526, 398, 1.6), (452, 368, 1.6), (466, 371, 1.8)]
part('freckles', (375, 360, 170, 50), circles(fr, C['freck']), seed=10, wobble=0.6, grain=0.0)
part('nose', (440, 345, 46, 52),
     f'<path d="M462 352 C470 368 478 380 470 390 C465 396 452 395 448 389" fill="{C["skin_sh"]}"/>', seed=12, wobble=1.5)

# eyes: one image per expression, both eyes (left eye centre 412,330; right eye 504,326, slightly smaller for 3/4)
EB = (365, 285, 190, 85)
def eye_pair(look=(0, 0), lid=0.0, kind='open'):
    out = ''
    for cx, cy, s in [(412, 330, 1.0), (504, 326, 0.93)]:
        if kind == 'closed':
            out += f'<path d="M{cx-21*s} {cy+2} q {21*s} {12*s} {42*s} 0" fill="none" stroke="{C["ink"]}" stroke-width="4.5" stroke-linecap="round"/>'
            continue
        if kind == 'happy':
            out += f'<path d="M{cx-20*s} {cy+6} q {20*s} {-18*s} {40*s} 0" fill="none" stroke="{C["ink"]}" stroke-width="4.5" stroke-linecap="round"/>'
            continue
        rx, ry = 19 * s, (26 if kind == 'wide' else 23) * s
        px, py = cx + look[0] * s, cy + look[1] * s
        out += (f'<clipPath id="e{cx}"><ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}"/></clipPath>'
                f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="{C["white"]}"/>'
                f'<g clip-path="url(#e{cx})"><circle cx="{px}" cy="{py}" r="{(9 if kind == "wide" else 11) * s}" fill="{C["ink"]}"/>'
                f'<circle cx="{px + 3*s}" cy="{py - 4*s}" r="{3*s}" fill="#fff"/>'
                + (f'<rect x="{cx-rx-2}" y="{cy-ry-2}" width="{2*rx+4}" height="{(2*ry+4)*lid}" fill="{C["skin"]}"/>' if lid > 0 else '') + '</g>'
                # thick upper lid, thin lower lid, lash flick at the outer corner
                f'<path d="M{cx-rx-2} {cy-ry*0.15 + (2*ry*lid if lid else 0) - ry*0.55} q {rx+2} {-ry*0.75 if not lid else -4} {2*rx+4} 0" fill="none" stroke="{C["ink"]}" stroke-width="5" stroke-linecap="round"/>'
                f'<path d="M{cx-rx*0.6} {cy+ry*0.95} q {rx*0.6} {4*s} {rx*1.2} 0" fill="none" stroke="{C["ink"]}" stroke-width="2" stroke-linecap="round" opacity=".6"/>')
    return out
EYES = [('open', dict()), ('up', dict(look=(6, -9))), ('half', dict(look=(4, -2), lid=0.42)), ('closed', dict(kind='closed')),
        ('wide', dict(kind='wide', look=(0, -1))), ('happy', dict(kind='happy'))]
for n, kw in EYES: part('eyes_' + n, EB, eye_pair(**kw), seed=13, wobble=0.8, grain=0.0)

BB = (365, 240, 190, 60)
def brows(lh, rh, lt=0, rt=0):
    out = ''
    for cx, base, h, t in [(410, 280, lh, lt), (502, 276, rh, rt)]:
        y = base - h
        out += f'<path d="M{cx-22} {y+4+t} Q{cx} {y-6} {cx+22} {y+4-t}" fill="none" stroke="{C["hair_dk"]}" stroke-width="8" stroke-linecap="round"/>'
    return out
for n, args in [('neutral', (0, 0)), ('raised', (12, 12)), ('think', (10, 0, 5, -3)), ('soft', (5, 5, -2, 2))]:
    part('brows_' + n, BB, brows(*args), seed=14, wobble=1.2, grain=0.0)

MB = (420, 405, 80, 50)
MOUTHS = {
    'rest': f'<path d="M444 425 q 14 9 28 0" fill="none" stroke="{C["ink"]}" stroke-width="3.6" stroke-linecap="round"/>',
    'hmm': f'<path d="M447 427 q 7 -4 16 1" fill="none" stroke="{C["ink"]}" stroke-width="3.6" stroke-linecap="round"/><ellipse cx="468" cy="426" rx="4" ry="3.5" fill="{C["lip"]}"/>',
    'oh': f'<ellipse cx="459" cy="428" rx="8" ry="10" fill="{C["lip"]}"/><ellipse cx="459" cy="433" rx="5" ry="4" fill="{C["tongue"]}"/>',
    'smile': f'<path d="M439 419 Q459 423 481 418 Q476 446 459 446 Q443 446 439 419 Z" fill="{C["lip"]}"/><path d="M446 437 Q459 430 472 437 Q466 445 459 445 Q451 445 446 437 Z" fill="{C["tongue"]}"/><path d="M441 420 Q459 425 479 419 L477 425 Q459 430 443 426 Z" fill="#fff"/>',
}
for n, body in MOUTHS.items(): part('mouth_' + n, MB, body, seed=15, wobble=0.7, grain=0.0)

part('glasses', (318, 280, 245, 100), f'''
  <circle cx="412" cy="330" r="37" fill="{C["lens"]}" opacity=".18"/><circle cx="504" cy="327" r="35" fill="{C["lens"]}" opacity=".18"/>
  <circle cx="412" cy="330" r="37" fill="none" stroke="{C["ink"]}" stroke-width="4.5"/>
  <circle cx="504" cy="327" r="35" fill="none" stroke="{C["ink"]}" stroke-width="4.5"/>
  <path d="M448 323 q 10 -8 21 -1" fill="none" stroke="{C["ink"]}" stroke-width="4"/>
  <path d="M376 322 L338 312" stroke="{C["ink"]}" stroke-width="4" stroke-linecap="round"/>
  <path d="M392 306 q 10 -8 22 -6" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".8"/>
  <path d="M486 303 q 9 -7 20 -5" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".8"/>''', seed=16, wobble=0.6, grain=0.0)

fringe_pts = [(372, 222, 40), (412, 205, 44), (456, 198, 44), (500, 202, 42), (540, 218, 40), (565, 245, 30), (348, 252, 30), (430, 232, 30), (478, 228, 30), (520, 240, 26)]
part('fringe', (305, 150, 300, 135), circles(fringe_pts, C['hair']) +
     ''.join(f'<path d="M{x} {y} q {r*0.7} {-r*0.5} {r} {r*0.35}" fill="none" stroke="{C["hair_hi"]}" stroke-width="6" stroke-linecap="round"/>'
             for x, y, r in [(392, 205, 26), (440, 190, 28), (488, 192, 26), (528, 210, 22)]), seed=17, wobble=3)

def ringlet(cx, top, n=4, r=15, seed=20):
    # a hanging spiral curl: stacked loops that shrink, slanted (RapidFireArt: rounded, tapered end)
    body = ''
    for i in range(n):
        y = top + 18 + i * 22; rr = r * (1 - i * 0.14); dx = (-1 if i % 2 else 1) * 3
        body += f'<ellipse cx="{cx + dx}" cy="{y}" rx="{rr}" ry="{rr*0.85}" fill="{C["hair"]}"/>'
        body += f'<path d="M{cx+dx-rr*0.6} {y-2} q {rr*0.6} {-rr*0.6} {rr*1.1} {rr*0.2}" fill="none" stroke="{C["hair_hi"]}" stroke-width="4" stroke-linecap="round"/>'
    body += f'<path d="M{cx-6} {top+18+n*22-10} q 4 18 -2 26" fill="none" stroke="{C["hair"]}" stroke-width="8" stroke-linecap="round"/>'
    return body
part('curlL', (322, 380, 56, 130), ringlet(350, 380, seed=21), seed=21, wobble=2)
part('curlR', (540, 372, 56, 130), ringlet(568, 372, seed=22), seed=22, wobble=2)

# ------------------------------------------------------------------ NECK + BODY
part('neck', (405, 430, 100, 150), f'<path d="M418 440 L490 440 L496 575 L410 575 Z" fill="{C["skin"]}"/>'
     f'<path d="M418 440 C440 486 470 488 492 452 L492 440 Z" fill="{C["skin_sh"]}"/>', seed=23)
stripes = f'<pattern id="st" width="60" height="38" patternUnits="userSpaceOnUse"><rect width="60" height="21" fill="{C["teal"]}"/><rect y="21" width="60" height="17" fill="{C["cream"]}"/></pattern>'
torso = 'M292 900 C292 720 318 618 372 578 C392 565 412 560 430 560 L482 560 C500 560 522 566 542 578 C598 618 626 720 628 900 Z'
part('torso', (285, 550, 350, 360), f'<path d="{torso}" fill="url(#st)"/>'
     f'<path d="M412 562 C430 590 482 592 500 562" fill="none" stroke="{C["cream"]}" stroke-width="14" stroke-linecap="round"/>'
     f'<path d="M560 600 C600 650 620 760 626 900 L600 900 C596 780 584 680 560 600 Z" fill="{C["teal_dk"]}" opacity=".35"/>', seed=24, defs=stripes)
cord = f'<pattern id="cd" width="9" height="40" patternUnits="userSpaceOnUse"><rect width="9" height="40" fill="{C["mustard"]}"/><rect width="2.4" height="40" fill="{C["mustard_dk"]}" opacity=".55"/></pattern>'
part('pinafore', (340, 560, 245, 345), f'''
  <path d="M372 704 C372 690 380 684 392 684 L530 684 C542 684 550 690 550 704 L556 900 L366 900 Z" fill="url(#cd)"/>
  <path d="M384 690 L392 575 L414 572 L410 690 Z" fill="url(#cd)"/><path d="M512 690 L520 572 L542 575 L540 690 Z" fill="url(#cd)"/>
  <circle cx="401" cy="694" r="7" fill="{C["seed"]}"/><circle cx="526" cy="694" r="7" fill="{C["seed"]}"/>
  <path d="M415 760 L505 760 L500 820 C480 830 440 830 420 820 Z" fill="{C["mustard_dk"]}" opacity=".55"/>''', seed=25, defs=cord)
petals = ''.join(f'<ellipse cx="{400 + 13*math.cos(a)}" cy="{640 + 13*math.sin(a)}" rx="9" ry="5.5" transform="rotate({math.degrees(a)} {400 + 13*math.cos(a)} {640 + 13*math.sin(a)})" fill="{C["petal"]}"/>' for a in [i * math.pi / 5 for i in range(10)])
part('pin', (370, 610, 60, 60), petals + f'<circle cx="400" cy="640" r="8" fill="{C["seed"]}"/>', seed=26, wobble=1)

# ------------------------------------------------------------------ ARM (forearm + hand; the elbow sits below frame)
stripes_arm = f'<pattern id="sa" width="60" height="34" patternUnits="userSpaceOnUse" patternTransform="rotate(-13)"><rect width="60" height="19" fill="{C["teal_dk"]}"/><rect y="19" width="60" height="15" fill="#d9c9aa"/></pattern>'
part('sleeve', (520, 590, 190, 340), f'''
  <path d="M600 930 C596 820 584 704 556 632 L606 610 C646 690 676 810 700 930 Z" fill="url(#sa)"/>
  <path d="M600 930 C596 820 584 704 556 632 L572 626 C598 700 612 820 618 930 Z" fill="#1d4f4c" opacity=".35"/>
  <path d="M552 634 L604 608 L614 628 L562 656 Z" fill="{C["cream"]}"/>''', seed=27, defs=stripes_arm)
# cast shadow of the forearm on the chest (multiply, clipped to the torso)
part('armShadow', (500, 600, 140, 310), '<path d="M548 640 C566 720 580 820 588 905 L540 905 C536 820 528 720 520 650 Z" fill="#1d4f4c"/>', seed=29, wobble=5)
part('hand', (468, 455, 150, 195), f'''
  <path d="M548 632 C536 606 536 580 552 562 C566 548 594 552 604 572 C613 594 607 622 596 638 Z" fill="{C["skin"]}"/>
  <path d="M553 568 C540 546 521 513 504 485 C499 476 505 468 513 472 C528 494 550 526 568 552 Z" fill="{C["skin"]}"/>
  <path d="M556 562 C548 548 534 524 520 500" fill="none" stroke="{C["skin_sh"]}" stroke-width="3" stroke-linecap="round" opacity=".7"/>
  <ellipse cx="551" cy="584" rx="14" ry="10" fill="{C["skin"]}"/><ellipse cx="549" cy="603" rx="13" ry="9" fill="{C["skin"]}"/><ellipse cx="553" cy="620" rx="11" ry="8" fill="{C["skin"]}"/>
  <path d="M540 593 q 12 4 22 -1 M539 612 q 12 4 22 -1" fill="none" stroke="{C["skin_sh"]}" stroke-width="3.5" stroke-linecap="round"/>
  <path d="M600 574 C586 572 570 580 564 594 C574 598 590 592 600 584 Z" fill="{C["skin"]}"/>
  <path d="M598 585 C588 590 576 594 566 594" fill="none" stroke="{C["skin_sh"]}" stroke-width="3.5" stroke-linecap="round"/>
  <path d="M506 480 q 4 -4 9 -1" fill="none" stroke="{C["skin_sh"]}" stroke-width="3" stroke-linecap="round"/>''', seed=28)

# ------------------------------------------------------------------ RIG
def trs(x, y, a):
    c, s = math.cos(math.radians(a)), math.sin(math.radians(a)); return [c, s, -s, c, x, y]
def inv(m):
    a, b, c, d, e, f = m; det = a * d - b * c
    return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]
def app(m, x, y): return (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])
def norm(a): return (a + 180) % 360 - 180

BW = [  # id, parent, base, tip, extras
    ('chest', None, (458, 880), (458, 585), {}),
    ('neck', 'chest', (455, 568), (455, 470), {}),
    ('head', 'neck', (455, 462), (455, 200), {}),
    ('eyes', 'head', (458, 328), (498, 328), {}),
    ('brows', 'head', (456, 276), (496, 276), {}),
    ('curlL1', 'head', (350, 392), (350, 440), {'dynamics': {'enabled': True, 'stiffness': 0.14, 'damping': 0.16}}),
    ('curlL2', 'curlL1', (350, 440), (348, 492), {'dynamics': {'enabled': True, 'stiffness': 0.12, 'damping': 0.14}}),
    ('curlR1', 'head', (568, 384), (568, 432), {'dynamics': {'enabled': True, 'stiffness': 0.14, 'damping': 0.16}}),
    ('curlR2', 'curlR1', (568, 432), (566, 484), {'dynamics': {'enabled': True, 'stiffness': 0.12, 'damping': 0.14}}),
    ('forearm', 'chest', (652, 930), (578, 612), {}),
    ('hand', 'forearm', (578, 612), (500, 476), {}),
]
world, bones = {}, []
for bid, parent, a, t, ex in BW:
    wa = math.degrees(math.atan2(t[1] - a[1], t[0] - a[0])); ln = math.hypot(t[0] - a[0], t[1] - a[1])
    world[bid] = (a, wa)
    if parent:
        pa, pwa = world[parent]; lx, ly = app(inv(trs(pa[0], pa[1], pwa)), *a)
        b = dict(id=bid, name=bid, parent=parent, x=round(lx, 2), y=round(ly, 2), angle=round(norm(wa - pwa), 2))
    else:
        b = dict(id=bid, name=bid, parent=None, x=a[0], y=a[1], angle=round(wa, 2))
    b['length'] = round(ln, 2); b.update(ex); bones.append(b)

def L(id, name, asset_names, bone=None, group=None, **kw):
    if isinstance(asset_names, str): asset_names = [asset_names]
    x, y, w, h = BOXES[asset_names[0]]
    d = dict(id=id, name=name, drawings=[{'name': a.split('_')[-1], 'asset': a} for a in asset_names], active=0,
             bone=bone, group=group, bind='rigid', x=x, y=y, w=w, h=h, opacity=1, hidden=False, blend='normal')
    d.update(kw); return d
def G(id, name, bone, **kw):
    d = dict(id=id, name=name, type='group', drawings=[], bone=bone, group=None, blend='normal', opacity=1, hidden=False); d.update(kw); return d

layers = [
    L('hairBack', 'Hair back', 'hairBack', 'head'),
    G('body', 'Body', 'chest'),
    L('torso', 'Top (striped)', 'torso', group='body'),
    L('pinafore', 'Pinafore', 'pinafore', group='body'),
    L('pin', 'Sunflower pin', 'pin', group='body'),
    L('armShadow', 'Arm cast shadow', 'armShadow', group='body', blend='multiply', opacity=0.4),
    L('neckArt', 'Neck', 'neck', 'neck'),
    G('headG', 'Head', 'head'),
    L('ear', 'Ear', 'ear', group='headG'),
    L('faceColor', 'Face colour', 'faceColor', group='headG'),
    L('faceShade', 'Face shadow', 'faceShade', group='headG', clip=True, blend='multiply', opacity=0.55),
    L('blush', 'Blush', 'blush', group='headG', blend='multiply'),
    L('freckles', 'Freckles', 'freckles', group='headG', opacity=0.8),
    L('nose', 'Nose', 'nose', group='headG'),
    L('eyes', 'Eyes (switch)', ['eyes_' + n for n, _ in EYES], 'eyes', group='headG'),
    L('mouth', 'Mouth (switch)', ['mouth_' + n for n in MOUTHS], group='headG'),
    L('brows', 'Brows (switch)', ['brows_' + n for n in ['neutral', 'raised', 'think', 'soft']], 'brows', group='headG'),
    L('glasses', 'Glasses', 'glasses', group='headG'),
    L('curlL', 'Curl L', 'curlL', group='headG', bind='flexi', bones=['curlL1', 'curlL2'], mesh={'cols': 2, 'rows': 8, 'falloff': 2.5}),
    L('curlR', 'Curl R', 'curlR', group='headG', bind='flexi', bones=['curlR1', 'curlR2'], mesh={'cols': 2, 'rows': 8, 'falloff': 2.5}),
    L('fringe', 'Fringe', 'fringe', group='headG'),
    L('sleeve', 'Sleeve', 'sleeve', 'forearm'),
    L('hand', 'Hand (pointing)', 'hand', 'hand'),
]

anim_path = os.path.join(os.path.dirname(__file__), 'mira.anim.json')
anim = json.load(open(anim_path))['anim'] if os.path.exists(anim_path) else {'bones': {}, 'layers': {}}
project = dict(format='ai-rigging', version=1, name='Mira: the idea', width=900, height=900, fps=24, frames=96,
               background='#efe6d8', credits='Original character and art drawn in SVG by AI Rigging (CC0)',
               bones=bones, layers=layers, assets=ASSETS, anim=anim, actions={})
# eyes start looking up (thinking) at rest
for l in layers:
    if l['id'] == 'eyes': l['active'] = 1
    if l['id'] == 'brows': l['active'] = 2
    if l['id'] == 'mouth': l['active'] = 1
json.dump(project, open(OUT, 'w'))
print('wrote', OUT, len(bones), 'bones', len(layers), 'layers', len(ASSETS), 'assets')
