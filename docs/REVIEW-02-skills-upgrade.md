# Review 02: animating again after the skills upgrade

The cutout-animator and artificial-director skills were upgraded with researched anatomy, body mechanics, shape and pose rules, and the 12 principles as concrete checks ([docs/animation-knowledge](animation-knowledge/)). Then the Kenney wave was re-animated from scratch with those rules, checked with the new lint tool, and reviewed by eye.

Side-by-side: [kenney-v2-vs-v3.mp4](kenney-v2-vs-v3.mp4)

## What the new knowledge changed

| Rule (source file) | v2 | v3 |
|---|---|---|
| Shoulder girdle rises with a raised arm, 2:1 rhythm, collarbone up to 15° (anatomy) | No shoulder; the arm pivoted from a fixed socket | Collarbone bones added to the rig; the shoulder rises 13° and finishes 2 frames after the arm |
| Elbows never hover just past straight, never snap through straight (anatomy) | Elbow flipped its bend in 3 frames (F16-19) and hovered 8 to 35° reversed for 23 frames | Flip spread over 7 frames inside the swing; wave holds a committed palm-out bend (-40° or more) |
| Acting hand in clear negative space, no tangent with the head (shapes N1, P1) | Hand overlapped the hair (up to 52 px inside the head) | Hand at least 26 px clear of the head on every frame, chosen by a constraint search |
| Thought leads: eyes, brows, head (principles) | Eyes and head together | Eyes F8, brows F9, head F11 |
| Successive breaking of joints (mechanics) | Hand flicks loosely | Wrist breaks against each swing, 2 frames late |
| Line of action C, reverse to S on the settle (shapes L1, L5) | Mostly upright | Spine and head lean toward the friend (C), counter-tilt on the settle (S) |
| Duchenne smile: cheeks lift, lids narrow (FACS) | Mouth-only smile | Eyes narrow (sy 0.88) for the whole grin; the blink happens inside it |
| Asymmetric expressions (FACS) | Level brows | Brows tilt 2 to 4° |
| Moving hold (principles 5) | Dead first 9 frames | Breathing on the spine, a head drift |
| Purposeful, varied eases (principles 6) | 80% of moves "smooth" | fast-out, overshoot, anticipate, ease-in, linear pass-throughs |
| Anticipation before big moves (principles 2) | None before the arm drop | 7° lift before the arm comes down (F52-55) |

## Lint results (`node tools/anim-lint.js`)

| Version | MUST | SHOULD | COULD |
|---|---|---|---|
| v2 | 0 | 4 | 0 |
| v3 | 0 | 0 | 0 |

The lint itself was corrected during this round, because it raised false alarms that a supervisor would not:
- A big reversed elbow bend on a front-view arm is a rotated shoulder (palm out), not hyperextension. Only a limb **hovering** 8 to 35° past straight, or **snapping** through straight in under 4 frames, is flagged. Knees in side view are always strict.
- Eyes and brows that stop because the head stops are riding a parent, not a twinned stop. Only each part's own motion counts.
- A linear segment inside an eased move is a spacing tool; only a whole linear move is flagged.

## Still open (eye review, not caught by the lint)

- F18-21: a small pinch on the inner elbow of the sleeve mesh at the start of the swing. Fix later with a corrective smart-bone shape or a bent-sleeve swap.
- Feet are still locked, so the hips cannot shift weight. A true contrapposto needs foot pinning (top of the roadmap).
- Kenney hands are mittens. An open-palm wave drawing would read twice as well (asset request).
