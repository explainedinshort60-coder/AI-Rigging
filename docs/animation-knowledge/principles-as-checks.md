# The 12 principles as keying rules and review checks

For an animator that writes bone keys (angle, position, scale, ease) and reviews rendered frames. Definitions follow Thomas and Johnston (*The Illusion of Life*, 1981) and Lasseter's 1987 SIGGRAPH paper, which translates them into keyframe terms. **[C]** canonical, **[V]** convention, **[X]** proposed threshold to calibrate. Lasseter and Williams details were paraphrased, not re-read against the primary text in this research.

| # | Principle | Key it like this | Mistakes | Detect |
|---|---|---|---|---|
| 1 | Squash and stretch | Keep area: **sx × sy = 1** in 2D (stretch 1.1 means squash to about 0.91) [C]. Stretch along the path of motion at peak speed; squash on contact for 1 to 2 frames. Ball: stretch 1.2 to 1.5, squash 0.6 to 0.8 [V]. Bodies 0.9 to 1.1 subtle, to 0.8 / 1.25 cartoony [V]. Rigid props 0 to 5% | Area changes; stretch at the slowest frame or apex; axis not aligned with travel; squashing hands, faces, eyes | \|sx·sy − 1\| > 0.05 [X]; silhouette area of the part changes > 5% [X]; stretch with near-zero speed |
| 2 | Anticipation | A counter-move before every big action: about 5 to 15% of the main move, 3 to 8 frames before it [V]. Faster or more surprising actions need a clearer one. Omit it on purpose only for a snap or a gag | None; anticipation on every tiny move; "anticipation" in the same direction (just a slow start) | Big move (> 30° or > 20% of height) with no opposite-sign motion in the 3 to 8 frames before it, on the part or its body [X] |
| 3 | Staging | One idea at a time; the action reads in silhouette; the acting hand outside the torso; one focal point | Gesture hidden inside the body; two competing actions; tangents | Acting-hand keypoint inside the torso mask on the key frame; silhouette test |
| 4 | Straight ahead / pose to pose | Keys on story poses, then breakdowns (which set arcs and favoring), then let the interpolator in-between. Layer straight-ahead passes on hair, tails, cloth by offsetting keys | Only start and end keys ("lazy 1 and 96") | Moves longer than about 12 frames with no breakdown key |
| 5 | Follow through and overlap | Offset child keys down the chain: hips, chest, neck, head and shoulder, elbow, wrist, fingers **1 to 2 frames per joint**; tails, ears, hair **2 to 4 per segment** [V]. Loose parts overshoot 10 to 30% then settle in 2 to 3 swings, each 40 to 60% of the last [V]. Moving holds | Everything stops on the same frame; overlap that drags late and rubbery | Parent and child keyed on the same frames; settle frames identical across a chain (spread < 1 frame) [X] |
| 6 | Slow in and slow out | Shape each ease for its job. Asymmetric: fast out of an anticipation, long cushion into a hold, sharp into a hit with overshoot. Spacing chart: halving into the key (gap ratio about 0.5), thirds for gentler (about 0.67), linear = 1 | Linear spacing on organic moves (robotic); the same soft ease on everything (mushy, floaty) | Constant per-frame change over 4+ frames; > 80% of moves share one ease [X] |
| 7 | Arcs | FK rotation arcs for free; **translations do not**. Add a breakdown 5 to 20% of the distance off the straight line, usually dipping under gravity [X]. Head turns dip through the middle | Root, head, hand or prop travelling straight; Euler wrap (350° to 10° the long way); kinks where translate and rotate keys disagree | Tip path bows less than 2% of its length on a long move; curvature zigzags [X] |
| 8 | Secondary action | Supports, never competes: hand drawings, blinks, brow sets, breathing, hair. Facial changes at the start or end of a fast move | Dead hands, static face; secondary louder than primary | Secondary amplitude above primary; starting on the exact frame of the primary key |
| 9 | Timing | Frames set weight and mood. Contrast: 3 to 6 frame snaps against 12 to 24 frame moves and real holds. Body on 2s, 1s for fast action and camera moves (TV norm) | Everything the same length; holds too short to read (2 to 5 frames); metronome intervals | Longest/shortest move ratio < 2; more than half the moves the same length [X] |
| 10 | Exaggeration | More convincing, not more distorted; push key poses past the rig's comfortable range, swap a drawing where it breaks. Exaggerate timing contrast too. Balance it across the scene | Everything polite and mid-range | Key-pose amplitude vs a plain version (aim 1.2 to 2× for cartoon) [X]; line of action angle on keys |
| 11 | Solid drawing | Volume and weight; contrapposto; no twins; in cutout, view swaps and in-between angle drawings for turns | Pancake characters; mirrored limbs; sliding features over a fixed head | Left/right curves correlated > 0.95 [X]; mirrored silhouette overlap |
| 12 | Appeal | Clear design and readable, pleasing shapes in every pose; clean joints; on-model swaps; 1 to 3 custom drawings where the rig is weakest | The correct-but-lifeless "explainer" look; off-model stretched hands or eyes at extremes | Proxies only: silhouette, twins, line of action, tangents, balance |

## Modern additions

- **Thought before action [V]:** eyes, then brows, then head lead the body by 2 to 6 frames.
- **Weight and balance:** centre of mass over the support between moves (see anatomy file).
- **Line of action and silhouette clarity** as separate checks (see shapes file).
- **Cutout-only faults:** pivot pops (seams opening at joints), z-order flips mid-move, drawing swaps landing on non-held frames, hinge joints snapping through straight, parts rotating past believable limits.

## Spacing math to key with

- Halving into a key over 8 frames: positions about 0, .25, .5, .69, .82, .91, .96, .99, 1.
- AI Rigging eases: `fast-out` = snap and long settle, `overshoot` = passes the target then settles (accents, arms arriving), `anticipate` = pulls back before going, `ease-in` / `ease-out` / `smooth` / `linear` / `step`, or a cubic bezier.
- Free fall: per-frame gaps grow 1 : 3 : 5 : 7.

## A keying recipe that applies all of it

1. Acting objective in one line. Beat map on frames.
2. Key poses (stepped): line of action, contrapposto, no twins, silhouette, 3/4 cheats.
3. Breakdowns: arcs and favoring for every move longer than about 8 frames.
4. Anticipation keys before big moves; overshoot and settle after them.
5. Eases per move, asymmetric.
6. Offsets down every chain (1 to 2 per joint, 2 to 4 on loose parts), staggered settles.
7. Face pass: eyes lead, brows, head, then mouth; Duchenne smiles; blinks on thought changes.
8. Moving holds: nothing frozen longer than about 12 frames unless the style wants it.
9. Lint (`node tools/anim-lint.js shot.rig.json`), render, contact sheet, review your own shot like someone else's, fix, repeat.

## Research and tools that apply the principles procedurally

- Wang et al., *The Cartoon Animation Filter* (SIGGRAPH 2006): subtracts a smoothed second derivative from any motion curve, adding anticipation and follow-through automatically. https://grail.cs.washington.edu/wp-content/uploads/2015/08/wang-2006-tca.pdf
- Chenney et al., *Simulating Cartoon Style Animation* (NPAR 2002), volume-preserving automatic squash and stretch. https://pages.cs.wisc.edu/~schenney/research/npar/cartoon/index.html
- Kazi et al., *Motion Amplifiers* (CHI 2016), principles as composable modules for 2D. https://www.research.autodesk.com/publications/motion-amplifiers-sketching-dynamic-illustrations-using-the-principles-of-2d-animation
- Velocity Skinning (2021), stylized squash and floppy deformation from bone velocity. https://arxiv.org/pdf/2104.04934

## Sources

- Lasseter, *Principles of Traditional Animation Applied to 3D Computer Animation* (1987): https://courses.cs.washington.edu/courses/cse557/08wi/projects/animator/linkedItems/lasseter.pdf
- SIGGRAPH HyperGraph summaries: https://education.siggraph.org/static/HyperGraph/animation/character_animation/principles/prin_trad_anim.htm
- Thomas and Johnston, *The Illusion of Life* (1981), book; overview: https://www.openculture.com/2015/04/disneys-12-timeless-principles-of-animation-demonstrated-in-12-animated-primers.html
- Williams, *The Animator's Survival Kit* (2001), book.
- Successive breaking of joints: https://www.brianlemay.com/Pages/animationschool/animation/1stsemesteranimation/successivebreaking.html
- Timing and spacing: https://www.pluralsight.com/resources/blog/software-development/character-animation-fundamentals-timing-spacing
