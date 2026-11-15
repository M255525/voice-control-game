// 聲控大冒險 — 聲音分析引擎（純函式，瀏覽器與 Node 測試共用；不碰 DOM、不錄音、不上傳）
// 音量：RMS → dB → 依校準（背景噪音／最大聲）正規化成 0～1
// 音高：YIN 簡化版（差分函式＋累積平均正規化＋拋物線內插），70～1100 Hz

export const SENS_FACTOR = { 1: 0.6, 2: 0.8, 3: 1, 4: 1.25, 5: 1.55 };
export const PITCH_MIN_HZ = 70;
export const PITCH_MAX_HZ = 1100;

export function rmsOf(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / Math.max(1, buf.length));
}

export function dbOf(rms) { return 20 * Math.log10(Math.max(rms, 1e-6)); }

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** 校準值 cal = { noise: 背景噪音 dB, max: 大聲喊 dB }；回傳 0～1 */
export function levelFromDb(db, cal, sens = 3) {
  const floor = cal.noise + 6;                       // 比背景噪音大 6 dB 才算有出聲
  const ceil = Math.max(cal.max - 3, floor + 18);    // 喊到校準最大聲的 -3 dB 就算滿格；至少留 18 dB 動態範圍
  const x = (db - floor) / (ceil - floor);
  return clamp(x * (SENS_FACTOR[sens] || 1), 0, 1);
}

function median(arr) {
  if (!arr.length) return NaN;
  const a = [...arr].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
export function percentile(arr, p) {
  if (!arr.length) return NaN;
  const a = [...arr].sort((x, y) => x - y);
  return a[clamp(Math.round((a.length - 1) * p), 0, a.length - 1)];
}

/** 由兩段取樣（安靜時／大聲時，各為 dB 陣列）算出校準值 */
export function volumeCalibration(quietDbs, loudDbs) {
  const noise = Number.isFinite(median(quietDbs)) ? median(quietDbs) : -60;
  let max = Number.isFinite(percentile(loudDbs, 0.85)) ? percentile(loudDbs, 0.85) : noise + 30;
  const ok = max - noise >= 15;                     // 大聲時至少比安靜大 15 dB，否則視為校準失敗（但仍給可用的預設）
  if (!ok) max = noise + 28;
  return { noise: +noise.toFixed(1), max: +max.toFixed(1), ok };
}

/** 由一段唱歌取樣的 Hz 陣列取出穩定音高（去掉離群值） */
export function stablePitch(hzList) {
  const v = hzList.filter(h => h > 0);
  if (v.length < 5) return null;
  return median(v);
}

/** 依低音、高音算出音域（低高差至少 7 個半音，否則往兩邊撐開） */
export function pitchRange(lowHz, highHz) {
  let lo = Math.min(lowHz, highHz), hi = Math.max(lowHz, highHz);
  const semis = 12 * Math.log2(hi / lo);
  if (!(semis >= 7)) {
    const mid = Math.sqrt(lo * hi) || 200;
    lo = mid / Math.pow(2, 4.5 / 12); hi = mid * Math.pow(2, 4.5 / 12);
  }
  return { lo: +lo.toFixed(1), hi: +hi.toFixed(1) };
}

export const VOICE_PRESETS = {
  low: { lo: 98, hi: 262, label: '低音（多數男聲）' },
  mid: { lo: 147, hi: 392, label: '中音' },
  high: { lo: 196, hi: 523, label: '高音（多數女聲、小朋友）' },
};

/**
 * 音高偵測（YIN 簡化版）。buf：Float32Array 時域樣本；sr：取樣率
 * 回傳 { hz, clarity } 或 null（太小聲／不像有音高的聲音）
 */
export function detectPitch(buf, sr, opts = {}) {
  const minHz = opts.minHz || PITCH_MIN_HZ, maxHz = opts.maxHz || PITCH_MAX_HZ;
  const th = opts.threshold || 0.15;
  if (rmsOf(buf) < (opts.minRms || 0.008)) return null;
  const minLag = Math.max(2, Math.floor(sr / maxHz));
  const maxLag = Math.min(Math.floor(sr / minHz), Math.floor(buf.length / 2));
  const W = buf.length - maxLag;
  if (W < 64 || maxLag <= minLag + 2) return null;
  const d = new Float32Array(maxLag + 2);
  for (let tau = 1; tau <= maxLag + 1; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) { const df = buf[i] - buf[i + tau]; s += df * df; }
    d[tau] = s;
  }
  // 累積平均正規化差分
  const dn = new Float32Array(maxLag + 2);
  dn[0] = 1; let run = 0;
  for (let tau = 1; tau <= maxLag + 1; tau++) { run += d[tau]; dn[tau] = run > 0 ? d[tau] * tau / run : 1; }
  let tau = -1;
  for (let t = minLag; t <= maxLag; t++) {
    if (dn[t] < th) { while (t + 1 <= maxLag && dn[t + 1] < dn[t]) t++; tau = t; break; }
  }
  if (tau < 0) {                                       // 沒有低於門檻的就取全域最小，但清晰度要夠
    let best = minLag;
    for (let t = minLag; t <= maxLag; t++) if (dn[t] < dn[best]) best = t;
    if (dn[best] > 0.35) return null;
    tau = best;
  }
  // 拋物線內插
  const a = dn[tau - 1], b = dn[tau], c = dn[tau + 1];
  const den = a - 2 * b + c;
  const shift = den !== 0 ? clamp(0.5 * (a - c) / den, -1, 1) : 0;
  const hz = sr / (tau + shift);
  if (hz < minHz || hz > maxHz) return null;
  return { hz, clarity: clamp(1 - b, 0, 1) };
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SOLFA = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
export function hzToNote(hz) {
  if (!(hz > 0)) return null;
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  return { midi, name: NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1), solfa: SOLFA[((midi % 12) + 12) % 12] };
}

/** 音高 → 0（音域最低）～1（最高），對數刻度 */
export function pitchPos(hz, range) {
  return clamp(Math.log2(hz / range.lo) / Math.log2(range.hi / range.lo), 0, 1);
}

/**
 * 「喊一聲」偵測：音量先安靜 ≥ quietSec，再衝上門檻 th 就算一次。
 * update(level, dt, th) 回傳 true 代表這一幀喊了一聲。
 */
export class OnsetDetector {
  constructor(quietSec = 0.08) { this.quietSec = quietSec; this.quiet = 1; this.armed = true; }
  update(level, dt, th) {
    if (level < th * 0.55) { this.quiet += dt; if (this.quiet >= this.quietSec) this.armed = true; }
    else if (level < th) { /* 灰色地帶：不累積也不重置 */ }
    if (this.armed && level >= th) { this.armed = false; this.quiet = 0; return true; }
    if (level >= th * 0.55) this.quiet = 0;
    return false;
  }
}

/** 音高中位數平滑（去掉單幀八度跳動） */
export class PitchSmoother {
  constructor(n = 5) { this.n = n; this.buf = []; this.miss = 0; }
  push(hz) {
    if (!(hz > 0)) { if (++this.miss > 4) this.buf = []; return this.value(); }
    this.miss = 0;
    // 跟上一個值差超過 9 個半音（多半是八度誤判），先不信它
    const cur = this.value();
    if (cur && Math.abs(12 * Math.log2(hz / cur)) > 9 && this.buf.length >= 3) { this.buf.shift(); return cur; }
    this.buf.push(hz); if (this.buf.length > this.n) this.buf.shift();
    return this.value();
  }
  value() { return this.buf.length ? median(this.buf) : null; }
}

/* ---------- 🎵 唱歌小鳥的音符路線（自寫的簡單級進／跳進組合，0＝最低階、7＝最高階） ---------- */
export const BIRD_LANES = 8;
export const PATTERNS = [
  { name: '慢慢往上', notes: [0, 1, 2, 3, 4, 5, 6, 7] },
  { name: '慢慢往下', notes: [7, 6, 5, 4, 3, 2, 1, 0] },
  { name: '長長一聲', notes: [3, 3, 3, 3, 3] },
  { name: '小山丘', notes: [0, 2, 4, 2, 0] },
  { name: '大山丘', notes: [1, 4, 7, 4, 1] },
  { name: '樓梯', notes: [2, 2, 4, 4, 6, 6] },
  { name: '溜滑梯', notes: [6, 6, 4, 4, 2, 2] },
  { name: '跳跳', notes: [1, 5, 1, 5] },
  { name: '波浪', notes: [3, 5, 3, 1, 3, 5] },
  { name: '高高的', notes: [6, 7, 6, 7, 6] },
  { name: '低低的', notes: [1, 0, 1, 0, 1] },
];
export const EASY_PATTERNS = ['慢慢往上', '慢慢往下', '長長一聲', '小山丘', '樓梯', '溜滑梯', '低低的'];

/** 依難度挑下一段旋律（rand 可注入以便測試） */
export function pickPattern(diff, rand = Math.random, last = '') {
  const pool = PATTERNS.filter(p => (diff === 'easy' ? EASY_PATTERNS.includes(p.name) : true) && p.name !== last);
  return pool[Math.floor(rand() * pool.length) % pool.length];
}

/** 音高階 → 0～1 高度位置（第 0 階在 0.06、第 7 階在 0.94） */
export function laneToPos(lane) { return 0.06 + (lane / (BIRD_LANES - 1)) * 0.88; }

/* ---------- 🥁 節奏太鼓：譜面與判定（節奏型都是自寫的，以「拍」為單位、一小節 4 拍） ---------- */
// k：s＝小鼓點（拍一下）、b＝大鼓點（用力拍／大聲喊）、r＝連打條（len 拍內拍越多下越多分）
export const DRUM_BPM = { easy: 80, normal: 100, hard: 120 };
export const DRUM_WIN = {   // 判定窗（秒，前後各算）
  easy: { perfect: 0.11, good: 0.2 }, normal: { perfect: 0.085, good: 0.16 }, hard: { perfect: 0.07, good: 0.13 },
};
export const DRUM_BARS = {
  easy: [
    [[0, 's'], [2, 's']], [[0, 's'], [1, 's'], [2, 's']], [[0, 's'], [1, 's'], [2, 's'], [3, 's']],
    [[0, 'b'], [2, 's']], [[0, 's'], [2, 'b']], [[0, 's'], [1, 's'], [2, 'b']],
  ],
  normal: [
    [[0, 's'], [1, 's'], [2, 's'], [3, 's']], [[0, 'b'], [1, 's'], [2, 's'], [3, 'b']],
    [[0, 's'], [1, 's'], [1.5, 's'], [2, 's']], [[0, 's'], [0.5, 's'], [1, 's'], [2, 'b']],
    [[0, 'r', 2], [3, 'b']], [[0, 's'], [1.5, 's'], [3, 's']], [[0, 'b'], [2, 'r', 1.5]],
  ],
  hard: [
    [[0, 's'], [0.5, 's'], [1, 's'], [2, 's'], [2.5, 's'], [3, 'b']], [[0, 'b'], [1.5, 's'], [2, 's'], [3.5, 's']],
    [[0, 's'], [0.5, 's'], [1, 'b'], [2, 's'], [2.5, 's'], [3, 'b']], [[0, 'r', 2], [2.5, 's'], [3, 'b']],
    [[0.5, 's'], [1, 's'], [2, 'b'], [2.5, 's'], [3.5, 's']], [[0, 's'], [1, 's'], [1.5, 's'], [2, 's'], [3, 'b'], [3.5, 'b']],
    [[0, 'b'], [1, 'r', 2], [3.5, 's']],
  ],
};
/** 產生整局譜面：lead 秒後開始、每 4～6 小節插一個休息小節；回傳依時間排序的 [{t, k, len(秒), i}] */
export function drumChart(diff, durationSec, rand = Math.random, lead = 3) {
  const bpm = DRUM_BPM[diff] || 100, spb = 60 / bpm, bars = DRUM_BARS[diff] || DRUM_BARS.normal;
  const out = [];
  let t0 = lead, bar = 0, sinceRest = 0, restEvery = 4 + Math.floor(rand() * 3), last = -1;
  while (t0 + 4 * spb <= durationSec - 0.5) {
    if (bar > 0 && sinceRest >= restEvery) { sinceRest = 0; restEvery = 4 + Math.floor(rand() * 3); }   // 休息一小節
    else {
      let pick = Math.floor(rand() * bars.length);
      if (bar === 0) pick = 0;                     // 第一小節固定最簡單的
      else if (pick === last) pick = (pick + 1) % bars.length;
      last = pick;
      bars[pick].forEach(([b, k, len]) => out.push({ t: +(t0 + b * spb).toFixed(4), k, len: k === 'r' ? +(len * spb).toFixed(4) : 0 }));
      sinceRest++;
    }
    t0 += 4 * spb; bar++;
  }
  out.sort((a, b) => a.t - b.t).forEach((n, i) => { n.i = i; });
  return out;
}
/** 判定一次打擊：回傳 { idx, grade:'perfect'|'good', dt } 或 null（附近沒有可打的鼓點）；連打條另外處理 */
export function drumJudge(notes, t, win) {
  let best = null;
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    if (n.done || n.k === 'r') continue;
    const d = t - n.t;
    if (d < -win.good) break;                     // 之後的都更晚
    if (Math.abs(d) <= win.good && (!best || Math.abs(d) < Math.abs(best.dt))) best = { idx: i, dt: d };
  }
  if (!best) return null;
  best.grade = Math.abs(best.dt) <= win.perfect ? 'perfect' : 'good';
  return best;
}
/** 現在正在經過判定線的連打條（含前後 good 窗） */
export function drumRollAt(notes, t, win) {
  return notes.find(n => n.k === 'r' && t >= n.t - win.good && t <= n.t + n.len + win.good) || null;
}
