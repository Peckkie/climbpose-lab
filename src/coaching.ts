// Coaching text — the editable rule table for crux cues and tips (English + Thai).
// When each cue / tip is shown is decided in core/crux using the thresholds in CONFIG.crux
// (knee bent < 155°, hips low < 38 %, reach arm bent < 150°, reach < 88 %, dynamic > 0.25 m/s,
// hands heavy > 60 %). Edit the wording here; English is what exports and the video overlay use.
// Pure data + formatting, no DOM.

export type CoachLang = 'en' | 'th';
export type Params = Record<string, number | string | undefined>;
type Say = Record<CoachLang, (p: Params) => string>;

const side = (lr: unknown, th: boolean) => (th ? (lr === 'R' ? 'ขวา' : 'ซ้าย') : String(lr));

/** Observations at the crux frame. bad = something to fix. */
export const CUES = {
  highPoint: { en: (p) => `High point: hand hold #${p.n}${p.m != null ? ` · ${p.m} m up` : ''}`, th: (p) => `จุดสูงสุด: โฮลด์มือ #${p.n}${p.m != null ? ` · สูง ${p.m} ม.` : ''}` },
  legBent: { en: (p) => `Push leg (${p.lr}) bent ${p.deg}°${p.o != null ? ` · other leg ${p.o}°` : ''}`, th: (p) => `ขาดัน (${side(p.lr, true)}) งอ ${p.deg}°${p.o != null ? ` · อีกขา ${p.o}°` : ''}` },
  legStraight: { en: (p) => `Push leg (${p.lr}) straight ${p.deg}°${p.o != null ? ` · other leg ${p.o}°` : ''}`, th: (p) => `ขาดัน (${side(p.lr, true)}) เหยียดตรง ${p.deg}°${p.o != null ? ` · อีกขา ${p.o}°` : ''}` },
  hipsLow: { en: (p) => `Hips low — ${p.pct}% of foot→hand`, th: (p) => `สะโพกต่ำ — ${p.pct}% ของระยะเท้าถึงมือ` },
  hipsUp: { en: (p) => `Hips up — ${p.pct}% of foot→hand`, th: (p) => `สะโพกสูงดี — ${p.pct}% ของระยะเท้าถึงมือ` },
  armBent: { en: (p) => `Reach arm bent ${p.deg}°`, th: (p) => `แขนที่เอื้อมงอ ${p.deg}°` },
  armLong: { en: (p) => `Reach arm long ${p.deg}°`, th: (p) => `แขนที่เอื้อมเหยียดยาว ${p.deg}°` },
  reach: { en: (p) => `Body at ${p.pct}% of full reach`, th: (p) => `ตัวยืดได้ ${p.pct}% ของระยะเอื้อมเต็มที่` },
  nextHold: { en: (p) => `Next hold ~${p.cm} cm away`, th: (p) => `โฮลด์ถัดไปห่าง ~${p.cm} ซม.` },
  dynamic: { en: (p) => `Moving up ${p.ms} m/s (dynamic)`, th: (p) => `กำลังพุ่งขึ้น ${p.ms} ม./วิ (dynamic)` },
  static: { en: (p) => `Static at max reach (${p.ms} m/s)`, th: (p) => `นิ่งตอนเอื้อมสุด (${p.ms} ม./วิ)` },
  handsHeavy: { en: (p) => `Hands carrying ${p.pct}% of body weight`, th: (p) => `มือรับน้ำหนัก ${p.pct}% ของตัว` },
  feetCarry: { en: (p) => `Feet carrying ${p.pct}% of body weight`, th: (p) => `เท้ารับน้ำหนัก ${p.pct}% ของตัว` },
} satisfies Record<string, Say>;

/** What to try next time. */
export const TIPS = {
  straightenLeg: { en: () => 'Straighten the push leg fully before you let go — drive through the foot.', th: () => 'เหยียดขาดันให้สุดก่อนปล่อยมือ — ดันผ่านเท้าขึ้นไป' },
  hipsUp: { en: () => 'Get the hips up first: step the feet higher or rock over before the move.', th: () => 'ยกสะโพกขึ้นก่อน: ขยับเท้าให้สูงขึ้นหรือ rock over ก่อนขยับมือ' },
  straightArm: { en: () => 'Reach from a straight arm — turn the hip into the wall to add length.', th: () => 'เอื้อมจากแขนที่เหยียดตรง — บิดสะโพกเข้าผนังเพื่อเพิ่มระยะ' },
  fullLength: { en: () => 'Use your full length: flag a leg, rise on the toes, twist the hip in.', th: () => 'ใช้ความยาวตัวให้เต็มที่: flag ขา เขย่งปลายเท้า บิดสะโพกเข้า' },
  dynamicMore: { en: (p) => `Moving but still ${p.cm} cm short — generate more: sink lower, then drive with the legs.`, th: (p) => `ขยับแล้วแต่ยังขาด ${p.cm} ซม. — เพิ่มแรงส่ง: ย่อตัวลงก่อนแล้วดันด้วยขา` },
  goDynamic: { en: (p) => `Static reach maxed out, ${p.cm} cm short — go dynamic (deadpoint) or find a higher foot first.`, th: (p) => `เอื้อมนิ่งสุดแล้วยังขาด ${p.cm} ซม. — ลองไดนามิก (deadpoint) หรือหาเท้าที่สูงขึ้นก่อน` },
  closeGap: { en: (p) => `Fixing this should help close the ~${p.cm} cm gap.`, th: (p) => `แก้จุดนี้น่าจะช่วยปิดระยะที่ขาดราว ${p.cm} ซม.` },
  weightOnArms: { en: () => 'Weight is on the arms — set the feet so they take more load before the reach.', th: () => 'น้ำหนักอยู่ที่แขน — วางเท้าให้รับน้ำหนักมากขึ้นก่อนเอื้อม' },
} satisfies Record<string, Say>;

export type CueId = keyof typeof CUES;
export type TipId = keyof typeof TIPS;

export const sayCue = (id: CueId, p: Params, lang: CoachLang = 'en'): string => (CUES[id] as Say)[lang](p);
export const sayTip = (id: TipId, p: Params, lang: CoachLang = 'en'): string => (TIPS[id] as Say)[lang](p);
