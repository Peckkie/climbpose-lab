# CLIMB/POSE

> Repo: [Peckkie/climbpose-lab](https://github.com/Peckkie/climbpose-lab) · Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · Plan: [docs/ROADMAP.md](docs/ROADMAP.md)

Climbing movement lab that runs in the browser (builds to a single HTML file). Load a climbing video (outdoor rock or gym wall, tripod or handheld), and it:

- runs **MediaPipe Pose Landmarker** (33 keypoints) frame by frame in the browser
- **drops false detections** (pose jumping to the wall/floor for a few frames) and starts a fresh pose model per analysis, so a new clip never inherits the previous clip's tracking position
- **fixes left/right label swaps**: a Viterbi pass per body group (shoulders, hips, arms, legs) keeps labels continuous over time and penalises crossed thighs / upper arms, which the model produces when it mislabels a high-stepping leg
- **compensates for camera pan, zoom and roll** (handheld) by tracking wall texture behind the climber against keyframes, so paths and holds stay pinned to the wall
- computes **efficiency metrics** and a heuristic **Flow Score**
- counts **attempts** (both feet off the floor ≥ 1.5 s) and classifies how each ended (down-climb / fall or jump-off / still going)
- renders a stylized overlay (NEON · CHALK · THERMAL): glowing skeleton, CoM trail coloured by speed, limb trails, auto-detected holds (beta map), joint angles, HUD, a **ROUTE MAP** end card (every hand/foot placement on the rock, numbered in order, with time-coloured ghost skeletons and the CoM path) and a report card
- exports MP4 (original frame or 9:16 Reel with a follow cam) by rendering frame by frame with WebCodecs: exactly 30 fps, faster than real time, works with the tab in the background (falls back to real-time recording on browsers without WebCodecs); plus per-frame CSV and summary JSON

## Gym wall vs real rock

*ROUTE → Where*: **Auto-detect**, **Gym wall** or **Real rock**. Auto samples 3 frames: gym walls are large *smooth* panels with *vivid* plastic holds, real rock is textured everywhere with muted colours and vegetation (score = smooth + 2·vivid − 1.5·vegetation, gym if > 0.3; the sample gym clips scored 0.49–0.69, the outdoor boulder ≈ 0). Sky-heavy outdoor shots can look smooth — use the selector.

| | Gym wall | Real rock |
|---|---|---|
| Place | gym (+ Google Maps) | crag / area (+ Google Maps) |
| Route info | grade system + tag colour | grade (V / Font), no tag colour |
| Send = | both hands matched on the top hold ≥ 1 s (or top-out) | top-out only |
| Wording | SENT ✓ · FEET ABOVE FLOOR · ROUTE MAP | TOPPED OUT ✓ · FEET ABOVE GROUND · LINE MAP |
| HUD badge | GYM | ROCK |

History keeps the two apart (environment is part of the route key).

## Attempt results: sent / not sent + last hold

- Every attempt gets a result. **Sent** = both hands matched at the route's top level (within 20 cm, hands < 35 cm apart) for ≥ 1 s — the usual gym finish before dropping off — or an outdoor top-out. Override per attempt in the *Attempts* card (Auto / Sent / Not sent).
- **Sent:** the clip freezes 2.5 s on a **SENT ✓** card with the **TOP · LAST HOLD** ringed (the hold both hands matched on).
- **Not sent:** the crux freeze is headed **NOT SENT**, shows the **high point** (highest hand hold reached, its number and height) and rings the **LAST HOLD**.
- The HUD shows `A1 SENT ✓` / `A1 NOT SENT` after each attempt; the route map labels the last hold **TOP ✓** or **HIGH POINT**; re-grips of one hold are drawn as a single marker.

## v0.2 — body load + history (ideas from Cruxie, done our way)

- **Body load (kg · Nm):** enter body weight and wall angle (slab / vertical / overhang). Each frame, hands/feet that are still count as supports, and body weight is shared by solving **2D statics** — force vectors that sum to the weight and balance the torque about the CoM (weighted least-norm, feet preferred). Unlike distance-weighting (IDW) this respects torque balance and lets hands pull sideways; the off-the-wall share on overhangs goes to the hands. Shows kg at supporting hands/feet, Nm at shoulder/elbow/hip/knee (green → yellow → red), a "% weight on hands" line in the HUD timeline, a *Body load* card (share on hands, peak per hand, peak shoulder torque), and the load at each crux. Quasi-static and 2D: dynamic moves (dynos, catches) are underestimated.
- **Session history:** *Save this session* stores a summary in this browser. Sessions on the same route (gym + grade + tag + name) are listed with Flow Δ vs the previous one, % on hands and the crux gap.

## v0.1 — what's new

- **Route info:** pick a gym (saved in the browser; add one by pasting its **Google Maps link** — a full `google.com/maps/place/…` link fills in the name and coordinates, a short `maps.app.goo.gl` link is kept and the name typed; the 📍 button opens it), its grade system (V-scale, Font or a colour circuit like `Yellow=V0-V1, Green=V2-V3`), the grade, the tag colour and a route name. Shown on the HUD, the route map, the report card, in the JSON and in exported file names.
- **Route photo:** *Upload* a photo of the whole route, use *This frame* from the video, or *Auto* (frame where the attempt starts). The route map is drawn on that photo. An uploaded photo is mapped assuming it was **shot from the same spot as the camera** (camera on a tripod) — that keeps the mapping exact; a photo from a different angle will not line up.
- **Hold tagging:** tick *Tag holds* and click the video: click = hand hold, shift-click = foot hold, click an existing hold to remove it. Tagged holds get the current time, so they are numbered in climbing order on the route map, and they feed the crux "next hold" distance.
- **Coaching tips:** each crux now ends with up to three *TRY →* tips (straighten the push leg, get hips up, reach from a straight arm, use full length, go dynamic when static reach is maxed out).

Not in v0.1 yet: history across sessions of the same route (needs storage beyond one file), automatic gym grade lookup.

## Development (v0.3 refactor, in progress)

The app is a Vite + TypeScript project, split into the modules in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): `media` → `pose` + `camera` → `core/pipeline` →
`render` (a list of drawing layers) / `export` (video from a timeline of segments, data files),
with `route`, `environment`, `history`, the `ui` panels and the `app` store + actions around them.
The original single-file app is tag `v0.2`.

```bash
npm install
npm run dev           # app at http://localhost:5173
npm run build         # dist/ — static site to deploy
npm run build:single  # dist-single/index.html — one file, open it by double-click
npm test              # unit tests + regression vs accepted results on every fixture
npm run eval          # accuracy vs hand-checked labels → tests/eval/last-report.json
npm run typecheck
npm run lint:layers   # core must not touch the DOM / import upper layers
```

New test clip: analyze it in the app, press **Pose fixture (dev)**, put the `.pose.json` (gzip
optional) in `tests/fixtures/` (or `tests/fixtures/local/` if it can't be shared), then run
`npm run golden:update` to record its expected results.

Ground truth for a clip: open card **06 LABEL**, tick *Labelling mode*, step through the video and
press **S** (attempt start), **E** (end), **X** (sent / not), **C** (crux — the frame they came off),
**H** (last hold grabbed), **L** (left/right wrong from / to). Labels autosave in the browser and are
compared live with the app's result; *Download labels.json* and put it next to the clip's pose
fixture in `tests/fixtures/` so `npm run eval` measures it.

Camera tracking changed? Re-run it for a fixture from the video without the pose model:
`npx vite-node tools/retrack-camera.ts <video> tests/fixtures/<clip>.pose.json.gz --write`.

When you change analysis behaviour on purpose: `npm run golden:update`, review the diff of the
`*.golden.json` files and the `npm run eval` report, and commit them with the code change.

## Run

`npm run build:single` and open `dist-single/index.html` in Chrome (internet needed the first time
to load the model), or `npm run dev`.

1. Drop a video → set the analyze range and the climber's height
2. **Analyze climb** (Heavy model at 15 fps is a good default; ~1.5× clip length on an M3)
3. Play, pick a look, then **Export video with overlays**

## Crux breakdown (why did I fall?)

Idea from a V8 climber: the useful clip is the attempt you *didn't* finish. For every attempt that doesn't top out, the app finds the **crux frame** (the hand at its highest just before coming off, body not yet dropping) and checks the body there:

| Check | Flagged when |
|---|---|
| Push leg (planted foot) knee angle; other leg shown too | < 155° — leg not fully driven |
| Hip height as % of the foot → hand span | < 38% — hips low |
| Reaching elbow | < 150° — arm bent |
| Body extension (foot → hand ÷ leg + trunk + arm) | < 88% of full reach |
| Gap to the nearest hand hold above (seen used anywhere in the clip) | always shown, in cm |
| CoM vertical speed | > 0.25 m/s = dynamic, else static at max reach |

In the app: the **CRUX BREAKDOWN** list has a *Go to crux* button that jumps to that frame and pauses with the overlay. The player has frame-step (‹ › or the `,` `.` keys) and 0.25× / 0.5× slow motion for scrubbing. Exported videos freeze 3.5 s on each crux. Each crux also gets up to three *TRY →* coaching tips. Thresholds are a first guess, to tune with climbers' feedback.

## Metrics

| Metric | What it is |
|---|---|
| Attempts | Starts when a hand is above chest height and both feet are > 12 cm above the floor at the wall base; continues while the feet stay up (≥ 1.5 s); end = fall/jump-off if CoM drops > 1.2 m/s |
| Fluency (LDLJ) | Log dimensionless jerk of the CoM per move; closer to 0 = smoother |
| Path entropy (GIE) | log₂(2L / hull perimeter) of the CoM path per attempt (Cordier / Seifert); lower = more direct |
| Straight-arm rest | Share of still time with an elbow > 150° |
| Foot : Hand | Foot placements per hand grab (limb still ≥ 0.4 s) |
| High point | Highest foot above floor, CoM gain and vertical speed in the best attempt |
| Move / Rest | Share of on-wall time moving vs. still |

Scale comes from trunk length ≈ 0.29 × stature. Everything is a single-camera 2D estimate, so it's best for tracking the same climber on the same problem over time. The Flow Score weights (35% fluency, 25% path, 25% straight arms, 15% footwork) are this app's own heuristic and have not been validated.

## Known limits

- The floor is taken at the wall base (feet while a hand is on a start hold); the mat is seen in perspective, so heights are only meaningful near the wall
- Left/right can still be wrong when the hips are turned side-on (hips overlap, so a mislabelled leg doesn't look crossed)
- Camera compensation handles pan and tilt, not zoom or big rotation
- Back-to-camera and small, far-away climbers lower keypoint accuracy (use Heavy)
- Video URLs must allow CORS **and** HTTP range requests; local files always work

## References

- Beltrán et al., *Climbing Technique Evaluation by Means of Skeleton Video Stream Analysis*, Sensors 23(19) 8216, 2023
- arXiv 2505.12854
- Seifert / Cordier: geometric index of entropy for climbing fluency

## Sample results

`results/` holds renders of the two sample clips in all three looks: 9:16 Reel, 30 fps analysis, Heavy model, climber height 157 cm, follow cam 1.4× (IMG_4497) / 1.8× (IMG_4016).

| Clip | Attempts | Flow |
|---|---|---|
| IMG_4497 | 2 (0.0–6.0 s down-climb; 13.4 s → clip end) | 71 |
| IMG_4016 | 1 (4.3–32.5 s, jump-off) | 63 |
| test2 (outdoor boulder, screen-recorded) | 1 (10.8–65.5 s, top-out) | 77 |
