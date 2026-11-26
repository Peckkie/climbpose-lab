// Every tunable threshold in one place (docs/ARCHITECTURE.md principle 3).
// Values equal v0.2 exactly; change them here, then run `npm run eval` to see the effect.
// Times are in seconds, distances in metres unless noted.

export const CONFIG = {
  smoothing: {
    gapFillS: 0.5,            // interpolate missing pose up to this long
    drawSigmaS: 0.04,         // light smoothing (drawing, wall coords)
    metricSigmaS: 0.09,       // stronger smoothing (metrics, holds)
    visSigmaS: 0.1,
  },
  scale: {
    trunkToStature: 0.29,     // shoulder-mid → hip-mid ≈ 0.29 × height
    trunkBandLo: 0.6, trunkBandHi: 1.6, trunkPercentile: 0.75,
  },
  outliers: {
    windowS: 0.2, searchS: 0.6, minNeighbours: 5,
    hipJumpTrunks: 1.2, trunkMax: 1.6, trunkMin: 0.7,
  },
  leftRight: {
    prior: 0.02, crossPenalty: 0.5,
    sidePenalty: 0.6,         // legs: left knee/ankle/foot on the body's right side (per trunk of offset)
    sideAxisFull: 0.3,        // body left→right axis shorter than this (trunks, side-on) counts less
  },
  moving: { speedMs: 0.08, minRunS: 0.15 },
  floor: { atWallLo: 0.75, atWallHi: 1.33, percentile: 0.95, maxBaseAboveAllM: 0.8, handUpTrunks: 0.5,
    baseHandTrunks: 1.0,       // wall-base floor: only frames with a hand this many trunks above the hips (right at the wall)
    basePercentile: 0.95 },
  attempt: {
    feetUpM: 0.12, cleanRunS: 0.5, mergeGapS: 2, mergeHandUpShare: 0.6, minDurS: 1.5,
    dropMs: 1.2, dropLookbackS: 0.8, dropLookaheadS: 0.5,
    topOutMinFootM: 1, topOutWithinM: 0.3, topOutEndS: 0.5,
    stepUpRiseM: 0.15, stepUpWindowS: 0.6, stepUpLookbackS: 6, stepUpOffFloorM: 0.03, // low start footholds
  },
  holds: {
    handStillMs: 0.16, footStillMs: 0.13, minVis: 0.35, cleanRunS: 0.1, minDurS: 0.4,
    footMinAboveFloorM: 0.1, mergeDistM: 0.1, mergeGapS: 0.6, editMatchM: 0.07,
    groupDistM: 0.12,         // placements within this of a hold's centre are the same physical hold (re-grips, matches)
  },
  send: { topLevelM: 0.2, handsApartM: 0.35, matchS: 1.0, topHoldSearchM: 0.4, lastHoldLeadS: 0.5 },
  crux: {
    windowS: 2.5, afterS: 0.3, droppingMs: 0.8,
    kneeBentDeg: 155, hipsLowPct: 0.38, elbowBentDeg: 150, reachLowPct: 0.88, dynamicMs: 0.25,
    targetAboveM: 0.08, targetMinM: 0.06, targetMaxM: 1.0, handsHeavyShare: 0.6,
  },
  load: {
    supportSpeedMs: 0.5, supportCleanS: 0.15, assumedWeightKg: 60,
    weights: { LH: 0.6, RH: 0.6, LF: 1, RF: 1 }, g: 9.81, highLoadShareOfBw: 0.5,
  },
  flow: {
    weights: { fluency: 0.35, path: 0.25, arms: 0.25, feet: 0.15 },
    ldljLo: -13, ldljSpan: 8, gieLo: 0.4, gieSpan: 1.6, straightArmFull: 0.7, footHandFull: 1.1,
    straightArmDeg: 150, ldljMinSegS: 0.3,
  },
  camera: {
    followSigmaS: 0.6,
    trackMedianS: 0.2,        // similarity camera track: median filter (drops single-frame mis-fits) …
    trackSigmaS: 0.12,        // … then Gaussian smoothing (real camera motion is smooth; fit noise is not)
  },
} as const;

export type Config = typeof CONFIG;
