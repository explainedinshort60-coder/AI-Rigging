# AI Rigging project format (`.rig.json`, version 1)

One JSON object. Everything is plain data so it can be written by hand, by scripts, or by an AI assistant.

## Conventions

- Units are pixels and **degrees**.
- Angle `0` points right (+x). Positive angles turn **clockwise on screen**, because canvas y points down. `-90` points up.
- **Frame 0 is the rest (setup) pose.** Animation plays frames `1..frames`, then loops back to 1.
- To loop cleanly, add a key at frame `frames + 1` equal to the frame 1 key.

## Top level

```json
{
  "format": "ai-rigging", "version": 1,
  "name": "Pip demo",
  "width": 800, "height": 600,
  "fps": 24, "frames": 48,
  "background": "#fff7ea",
  "bones":   [ ... ],
  "layers":  [ ... ],
  "assets":  { "assetId": "data:image/png;base64,..." },
  "anim":    { "bones": { ... }, "layers": { ... } },
  "actions": { "smartBoneId": { "bones": { ... }, "layers": { ... } } }
}
```

## Bones

```json
{
  "id": "armR_lo", "name": "Arm R lower", "parent": "armR_up",
  "x": 55, "y": 0, "angle": 0, "length": 55,
  "strength": 0,
  "constraint": { "enabled": true, "min": -150, "max": 10 },
  "dynamics":   { "enabled": true, "stiffness": 0.18, "damping": 0.18, "gravity": 0, "limit": 80 },
  "smart":      { "min": 0, "max": 90 }
}
```

| Field | Meaning |
|---|---|
| `x`, `y`, `angle` | Rest transform in the **parent's** space (world space for root bones). |
| `length` | Bone length. The tip is at local `(length, 0)`. |
| `strength` | Mesh influence radius. `0` means automatic (60% of length). |
| `constraint` | Clamp on the absolute local angle. Also limits IK. |
| `dynamics` | Spring follow-through. Simulated, so do not key these bones by hand. |
| `smart` | Marks the bone as a dial. Its animated angle offset (degrees) plays its action. |

Bones may be listed in any order; the engine sorts parents before children.

## Layers

```json
{
  "id": "mouth", "name": "Mouth (switch)",
  "drawings": [ { "name": "neutral", "asset": "mouthNeutral" }, { "name": "smile", "asset": "mouthSmile" } ],
  "active": 0,
  "bone": "head",
  "bind": "rigid",
  "bones": [],
  "mesh": { "cols": 6, "rows": 6 },
  "x": 370, "y": 304, "w": 60, "h": 34,
  "opacity": 1, "hidden": false
}
```

| Field | Meaning |
|---|---|
| `drawings` | One drawing = image layer. Several = switch layer. |
| `active` | Drawing shown at rest and when nothing keys `switch`. |
| `bind: "rigid"` | The layer follows `bone` as a solid piece (Moho layer binding). |
| `bind: "mesh"` | The image becomes a `cols x rows` grid. Each vertex is skinned to the bones in `bones` (weights by distance to each bone at rest and bone strength). |
| `flipX`, `flipY` | Mirror the drawing (reuse one arm, leg or shoe drawing for both sides). |
| `mesh.falloff` | Weight falloff for mesh layers. Default 2.5. Lower = softer joints, higher = stiffer segments. |
| `x, y, w, h` | Placement of the image in **world space at rest** (frame 0). |

Array order is draw order: first is at the back.

### Groups, clipping, blend modes

Layers form a tree. A **group** is a layer with `"type": "group"` and no drawings; its children point to it with `"group": "<groupId>"`.

```json
{ "id": "head_grp", "name": "Head", "type": "group", "bone": "head", "blend": "normal", "opacity": 1, "drawings": [] },
{ "id": "head_color",  "group": "head_grp", "drawings": [ ... ] },
{ "id": "head_tex",    "group": "head_grp", "clip": true, "blend": "multiply", "screenLock": true, "drawings": [ ... ] },
{ "id": "head_shadow", "group": "head_grp", "clip": true, "blend": "multiply", "drawings": [ ... ] },
{ "id": "head_hl",     "group": "head_grp", "clip": true, "blend": "screen", "opacity": 0.7, "drawings": [ ... ] },
{ "id": "head_line",   "group": "head_grp", "drawings": [ ... ] }
```

| Field | Meaning |
|---|---|
| `type: "group"` | Container. Draw order inside it = array order of its children (plus keyed `z`). |
| `group` | Parent group id. Missing or unknown = top level. |
| `bone` on a group | Children with no `bone` of their own (and not mesh-bound to their own bones) follow it. Bind once per part. |
| `blend` | `normal`, `multiply`, `screen`, `overlay`, `darken`, `lighten`, `color-dodge`, `color-burn`, `hard-light`, `soft-light`, `difference`, `add`. |
| `clip` | Clipped to the nearest non-clipped layer **below** it in the same container (Photoshop clipping mask). The base's blend and opacity apply to the whole clipped stack. |
| `screenLock` | The drawing ignores bones and stays fixed to the stage. Clip it to a colour layer for a texture that stays still while the part moves. |
| group `blend` / `opacity` | A group with a blend mode or opacity under 1 is composited as one isolated image; otherwise its children blend straight through (Photoshop "pass through"). |

A typical part stack, back to front: **colour** (base) · **texture** (multiply, clipped, often screen-locked) · **shadow** (multiply, clipped) · **highlight** (screen, clipped) · **line**.

## Keys and channels

A track is an array of keys: `[frame, value, ease]`. The ease shapes the segment **after** the key. Before the first key the first value holds; after the last key the last value holds.

Eases: `linear`, `smooth`, `ease-in`, `ease-out`, `fast-out`, `overshoot`, `anticipate`, `step`, or a cubic bezier `[x1, y1, x2, y2]` (same as CSS `cubic-bezier`).

| Store | Channel | Meaning |
|---|---|---|
| `bones.<id>` | `a` | Degrees **added** to the rest angle. |
| | `x`, `y` | Pixels added to the rest position (parent space). |
| | `sx`, `sy` | Scale multipliers (1 = rest). `sx` stretches along the bone. Children inherit. |
| `layers.<id>` | `switch` | Drawing index. Always stepped. |
| | `opacity` | Multiplier, 0 to 1. |
| | `z` | Draw-order offset, stepped. `+2` moves the layer two places toward the front for that stretch of the shot. |

```json
"anim": {
  "bones":  { "armR_up": { "a": [[1, -10, "fast-out"], [9, -62, "smooth"], [41, -62, "smooth"], [49, -10]] } },
  "layers": { "eyes":    { "switch": [[1, 0, "step"], [20, 1, "step"], [22, 0, "step"]] } }
}
```

## Smart bone actions

`actions.<smartBoneId>` has the same shape as `anim`, but the "frame" of each key is the **dial value in degrees**. At evaluation time:

1. The dial is the smart bone's animated angle offset (its `a` track).
2. Each action track is sampled at that dial value and added on top of the animation (multiplied for `sx`, `sy`, `opacity`).
3. Action `switch` tracks override the timeline while the dial is away from 0.

```json
"actions": {
  "smile": {
    "bones":  { "head":  { "a": [[0, 0, "smooth"], [90, -8, "smooth"]] } },
    "layers": { "mouth": { "switch": [[0, 0, "step"], [25, 1, "step"], [65, 2, "step"]] } }
  }
}
```

Keying `anim.bones.smile.a` from 0 to 45 then makes Pip smile; 80 makes him laugh.

## Evaluation order

1. Rest locals from each bone.
2. `anim` tracks at the frame (frame 1+ only).
3. Smart bone actions at each dial value.
4. Angle constraints.
5. Forward kinematics.
6. Bone dynamics (playback and export).
7. Layers drawn back to front through the group tree: rigid layers by `boneWorld * inverse(boneRest)`, mesh layers by linear blend skinning, clipping stacks and blended groups composited in offscreen buffers cropped to their bounds.

## Partial JSON for "Paste anim JSON"

The editor accepts a full project, or just:

```json
{ "anim": { ... }, "actions": { ... }, "frames": 72, "fps": 24 }
```
