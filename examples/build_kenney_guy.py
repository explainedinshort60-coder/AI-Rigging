#!/usr/bin/env python3
"""
Build an AI Rigging project from Kenney's CC0 "Modular Characters" pack.

  python3 examples/build_kenney_guy.py <path/to/modularcharacters/PNG> examples/kenney-guy.rig.json

Art: Kenney Vleugels, www.kenney.nl, CC0 1.0 (public domain).
Download: https://kenney.nl/assets/modular-characters

Bones are written in WORLD rest space here and converted to parent-local
transforms, the same way the editor does it.
"""
import base64, json, math, sys, os
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else 'modularcharacters/PNG'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'examples/kenney-guy.rig.json'
CX = 450  # stage centre line; left side parts are mirrored around it

PARTS = {
    'head': 'Skin/Tint 3/tint3_head.png', 'neck': 'Skin/Tint 3/tint3_neck.png', 'hand': 'Skin/Tint 3/tint3_hand.png',
    'shirt': 'Shirts/Pine/pineShirt3.png', 'sleeve': 'Shirts/Pine/pineArm_long.png',
    'hips': 'Pants/Navy/pantsNavy2.png', 'trouser': 'Pants/Navy/pantsNavy_long.png', 'shoe': 'Shoes/Black/blackShoe2.png',
    'hair': 'Hair/Black/blackMan3.png', 'eye': 'Face/Eyes/eyeBlack_large.png', 'brow': 'Face/Eyebrows/blackBrow1.png',
    'nose': 'Face/Nose/Tint 3/tint3Nose1.png',
    'mouthHappy': 'Face/Mouth/mouth_happy.png', 'mouthOh': 'Face/Mouth/mouth_oh.png', 'mouthGlad': 'Face/Mouth/mouth_glad.png',
}
assets, size = {}, {}
for k, rel in PARTS.items():
    path = os.path.join(SRC, rel)
    assets[k] = 'data:image/png;base64,' + base64.b64encode(open(path, 'rb').read()).decode()
    size[k] = Image.open(path).size

def mirror_x(x): return 2 * CX - x

# ---------------------------------------------------------------- bones (world)
# name, parent, base(x,y), tip(x,y)
B = [
    ('hips', None, (450, 590), (450, 548)),
    ('spine', 'hips', (450, 560), (450, 398)),
    ('neck', 'spine', (450, 392), (450, 362)),
    ('head', 'neck', (450, 362), (450, 196)),
    ('eyes', 'head', (450, 286), (480, 286)),
    ('brows', 'head', (450, 264), (480, 264)),
    # collarbone: pivots at the pit of the neck so the shoulder can rise with a raised arm
    ('shoulderR', 'spine', (462, 396), (514, 402)),
    ('armR_up', 'shoulderR', (514, 402), (598, 436)),
    ('armR_lo', 'armR_up', (598, 436), (660, 506)),
    ('handR', 'armR_lo', (660, 506), (676, 548)),
    ('legR_up', 'hips', (478, 590), (490, 662)),
    ('legR_lo', 'legR_up', (490, 662), (500, 734)),
    ('footR', 'legR_lo', (500, 734), (540, 750)),
]
# mirrored left side (R -> L on names that end in R or have R_ in them)
import re
def mir(n): return re.sub(r'R(?=_|$)', 'L', n) if n else n
for name, parent, a, t in list(B):
    if re.search(r'R(?=_|$)', name):
        B.append((mir(name), mir(parent) if parent and re.search(r'R(?=_|$)', parent) else parent,
                  (mirror_x(a[0]), a[1]), (mirror_x(t[0]), t[1])))

def trs(x, y, a):
    c, s = math.cos(math.radians(a)), math.sin(math.radians(a)); return [c, s, -s, c, x, y]
def inv(m):
    a, b, c, d, e, f = m; det = a * d - b * c
    return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]
def apply(m, x, y): return (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])
def norm(a): return (a + 180) % 360 - 180

world, bones = {}, []
for name, parent, a, t in B:
    wa = math.degrees(math.atan2(t[1] - a[1], t[0] - a[0]))
    ln = math.hypot(t[0] - a[0], t[1] - a[1])
    world[name] = (a, wa)
    if parent:
        pa, pwa = world[parent]
        lx, ly = apply(inv(trs(pa[0], pa[1], pwa)), *a)
        bone = {'id': name, 'name': name, 'parent': parent, 'x': round(lx, 2), 'y': round(ly, 2), 'angle': round(norm(wa - pwa), 2)}
    else:
        bone = {'id': name, 'name': name, 'parent': None, 'x': a[0], 'y': a[1], 'angle': round(wa, 2)}
    bone['length'] = round(ln, 2)
    bones.append(bone)
bmap = {b['id']: b for b in bones}
bmap['hips']['name'] = 'Hips (root)'
for side in 'LR':
    bmap[f'arm{side}_up']['constraint'] = {'enabled': False, 'min': -180, 'max': 180}

# ---------------------------------------------------------------- layers (back to front)
def L(id, name, asset, x, y, bone=None, bind='rigid', mbones=None, mesh=None, flip=False, drawings=None):
    w, h = size[asset]
    d = {'id': id, 'name': name, 'drawings': drawings or [{'name': asset, 'asset': asset}], 'active': 0,
         'bone': bone, 'bind': bind, 'x': x, 'y': y, 'w': w, 'h': h, 'opacity': 1, 'hidden': False}
    if flip: d['flipX'] = True
    if mbones: d['bones'] = mbones
    if mesh: d['mesh'] = mesh
    return d

sw, sh = size['sleeve']; tw, th = size['trouser']; hw, hh = size['hand']; shw, shh = size['shoe']
layers = [
    L('handL', 'Hand L', 'hand', mirror_x(641) - hw, 494, 'handL', flip=True),
    L('sleeveL', 'Sleeve L', 'sleeve', mirror_x(505) - sw, 388, 'armL_up', 'mesh', ['armL_up', 'armL_lo'], {'cols': 14, 'rows': 4, 'falloff': 2.5}, flip=True),
    L('trouserL', 'Trouser L', 'trouser', mirror_x(417) - tw, 572, 'legL_up', 'mesh', ['legL_up', 'legL_lo'], {'cols': 3, 'rows': 12, 'falloff': 2.5}, flip=True),
    L('trouserR', 'Trouser R', 'trouser', 417, 572, 'legR_up', 'mesh', ['legR_up', 'legR_lo'], {'cols': 3, 'rows': 12, 'falloff': 2.5}),
    L('shoeL', 'Shoe L', 'shoe', mirror_x(458) - shw, 722, 'footL', flip=True),
    L('shoeR', 'Shoe R', 'shoe', 458, 722, 'footR'),
    L('hipsArt', 'Pants top', 'hips', 373, 548, 'hips'),
    L('neckArt', 'Neck', 'neck', 402, 376, 'neck'),
    L('shirt', 'Shirt', 'shirt', 373, 384, 'spine'),
    # waving arm sits in front of the shirt so the raised shoulder never opens a gap
    L('handR', 'Hand R', 'hand', 641, 494, 'handR'),
    L('sleeveR', 'Sleeve R', 'sleeve', 505, 388, 'armR_up', 'mesh', ['armR_up', 'armR_lo'], {'cols': 14, 'rows': 4, 'falloff': 2.5}),
    L('headArt', 'Head', 'head', 363, 200, 'head'),
    L('nose', 'Nose', 'nose', 434, 298, 'head'),
    L('eyeL', 'Eye L', 'eye', 408, 276, 'eyes'),
    L('eyeR', 'Eye R', 'eye', 471, 276, 'eyes'),
    L('browL', 'Brow L', 'brow', 398, 256, 'brows'),
    L('browR', 'Brow R', 'brow', 462, 256, 'brows', flip=True),
    L('mouth', 'Mouth (switch)', 'mouthHappy', 433, 324, 'head',
      drawings=[{'name': 'happy', 'asset': 'mouthHappy'}, {'name': 'oh', 'asset': 'mouthOh'}, {'name': 'glad', 'asset': 'mouthGlad'}]),
    L('hair', 'Hair', 'hair', 371, 178, 'head'),
]

project = {
    'format': 'ai-rigging', 'version': 1, 'name': 'Kenney guy wave',
    'width': 900, 'height': 820, 'fps': 24, 'frames': 72, 'background': '#eaf2f8',
    'credits': 'Art: Kenney Modular Characters (www.kenney.nl), CC0 1.0',
    'bones': bones, 'layers': layers, 'assets': assets,
    'anim': {'bones': {}, 'layers': {}}, 'actions': {},
}
if os.path.exists(OUT.replace('.rig.json', '.anim.json')):
    project['anim'] = json.load(open(OUT.replace('.rig.json', '.anim.json')))['anim']
json.dump(project, open(OUT, 'w'), indent=1)
print('wrote', OUT, len(bones), 'bones', len(layers), 'layers')
