// node tools/test_engine.mjs — 聲音引擎單元測試（合成正弦波／噪音，不需要麥克風）
import * as E from '../engine.js';

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.log('FAIL:', msg); } }
const SR = 48000, N = 2048;
function tone(hz, amp = 0.3, harmonics = [1], noise = 0, phase = 0) {
  const b = new Float32Array(N);
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
  for (let i = 0; i < N; i++) {
    let v = 0;
    harmonics.forEach((h, k) => { v += h * Math.sin(2 * Math.PI * hz * (k + 1) * i / SR + phase); });
    b[i] = amp * v / harmonics.reduce((a, c) => a + c, 0) + noise * rnd();
  }
  return b;
}

// 1) 音高：純音、帶泛音（像人聲）、加噪音
for (const hz of [82, 110, 147, 196, 262, 330, 440, 523, 698, 880]) {
  const r = E.detectPitch(tone(hz), SR);
  ok(r && Math.abs(12 * Math.log2(r.hz / hz)) < 0.3, `純音 ${hz}Hz → ${r && r.hz.toFixed(1)}`);
  const r2 = E.detectPitch(tone(hz, 0.3, [1, 0.6, 0.4, 0.25, 0.15], 0.02), SR);
  ok(r2 && Math.abs(12 * Math.log2(r2.hz / hz)) < 0.5, `人聲泛音 ${hz}Hz → ${r2 && r2.hz.toFixed(1)}`);
}
// 基頻弱、二次泛音強（常見八度誤判情境）
{
  const r = E.detectPitch(tone(150, 0.3, [0.35, 1, 0.5]), SR);
  ok(r && Math.abs(12 * Math.log2(r.hz / 150)) < 0.5, `弱基頻 150Hz → ${r && r.hz.toFixed(1)}`);
}
ok(E.detectPitch(new Float32Array(N), SR) === null, '靜音 → null');
{
  const b = new Float32Array(N); let s = 7;
  for (let i = 0; i < N; i++) { s = (s * 16807) % 2147483647; b[i] = (s / 2147483647 - 0.5) * 0.6; }
  ok(E.detectPitch(b, SR) === null, '白噪音（吹氣聲）→ null');
}
ok(E.detectPitch(tone(220, 0.003), SR) === null, '太小聲 → null');
{ // 44.1k
  const b = new Float32Array(N); for (let i = 0; i < N; i++) b[i] = 0.3 * Math.sin(2 * Math.PI * 300 * i / 44100);
  const r = E.detectPitch(b, 44100); ok(r && Math.abs(r.hz - 300) < 3, `44.1kHz 300Hz → ${r && r.hz.toFixed(1)}`);
}

// 2) 音名
ok(E.hzToNote(440).name === 'A4', 'A4');
ok(E.hzToNote(261.63).name === 'C4' && E.hzToNote(261.63).solfa === 'Do', 'C4 Do');
ok(E.hzToNote(0) === null, '0Hz → null');

// 3) 音量正規化
const cal = { noise: -60, max: -20 };
ok(E.levelFromDb(-60, cal) === 0, '背景噪音 → 0');
ok(E.levelFromDb(-55, cal) === 0, '比噪音大 5dB 還不算出聲');
ok(E.levelFromDb(-23, cal) === 1, '接近最大聲 → 1');
const mid = E.levelFromDb(-38, cal);
ok(mid > 0.3 && mid < 0.7, `中間音量 → ${mid.toFixed(2)}`);
ok(E.levelFromDb(-38, cal, 5) > E.levelFromDb(-38, cal, 1), '靈敏度高 → 數值較大');
ok(E.levelFromDb(-45, { noise: -50, max: -48 }) < 1, '校準動態範圍太小時仍保留 18dB');
ok(E.dbOf(E.rmsOf(tone(200, 1))) > -4 && E.dbOf(0) === -120, 'dB 換算');

// 4) 校準
{
  const c = E.volumeCalibration([-62, -61, -60, -59, -63], [-25, -22, -20, -21, -30, -24]);
  ok(c.ok && c.noise === -61 && c.max <= -20 && c.max >= -24, `正常校準 ${JSON.stringify(c)}`);
  const bad = E.volumeCalibration([-60, -60], [-55, -56]);
  ok(!bad.ok && bad.max === -32, `沒喊出聲 → 失敗但給預設 ${JSON.stringify(bad)}`);
  const empty = E.volumeCalibration([], []);
  ok(Number.isFinite(empty.noise) && Number.isFinite(empty.max), '空取樣也有可用數值');
}
ok(Math.abs(E.stablePitch([0, 200, 201, 199, 400, 200, 198, 0]) - 200) < 2, '穩定音高取中位數');
ok(E.stablePitch([200, 0, 0]) === null, '樣本太少 → null');
{
  const r = E.pitchRange(300, 120); ok(r.lo === 120 && r.hi === 300, '音域高低順序可顛倒');
  const n = E.pitchRange(200, 210); ok(12 * Math.log2(n.hi / n.lo) >= 8.9, `音域太窄自動撐開到 9 半音 ${JSON.stringify(n)}`);
}
ok(E.pitchPos(98, E.VOICE_PRESETS.low) === 0 && E.pitchPos(262, E.VOICE_PRESETS.low) === 1, '音域兩端');
ok(Math.abs(E.pitchPos(Math.sqrt(98 * 262), E.VOICE_PRESETS.low) - 0.5) < 1e-9, '音域中點（對數）');
ok(E.pitchPos(50, E.VOICE_PRESETS.low) === 0 && E.pitchPos(2000, E.VOICE_PRESETS.low) === 1, '超出音域夾住');

// 5) 喊一聲偵測
{
  const d = new E.OnsetDetector(); const dt = 1 / 60; let n = 0;
  const seq = [...Array(20).fill(0), ...Array(30).fill(0.8), ...Array(3).fill(0.1), ...Array(10).fill(0.8), ...Array(20).fill(0), ...Array(10).fill(0.6)];
  seq.forEach(l => { if (d.update(l, dt, 0.4)) n++; });
  ok(n === 2, `持續喊只算一次、太短的停頓不算新的一聲、停夠再喊算第二次 → ${n}`);
  const d2 = new E.OnsetDetector(); let m = 0;
  [...Array(30).fill(0.3), ...Array(30).fill(0.35)].forEach(l => { if (d2.update(l, dt, 0.4)) m++; });
  ok(m === 0, '一直沒超過門檻 → 不算');
}

// 6) 平滑
{
  const s = new E.PitchSmoother(5);
  [200, 202, 199, 201].forEach(h => s.push(h));
  const v = s.push(400);                               // 八度跳動
  ok(Math.abs(v - 200) < 3, `單幀八度跳動被忽略 → ${v}`);
  for (let i = 0; i < 6; i++) s.push(0);
  ok(s.value() === null, '連續沒聲音後清空');
}

// 7) 旋律
ok(E.PATTERNS.every(p => p.notes.every(n => n >= 0 && n < E.BIRD_LANES)), '旋律都在 8 階內');
{
  let seed = 1; const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  let last = ''; let bad = 0;
  for (let i = 0; i < 200; i++) { const p = E.pickPattern('easy', rnd, last); if (!E.EASY_PATTERNS.includes(p.name) || p.name === last) bad++; last = p.name; }
  ok(bad === 0, '簡單難度只挑簡單旋律且不連續重複');
}
ok(E.laneToPos(0) === 0.06 && Math.abs(E.laneToPos(7) - 0.94) < 1e-9, '階 → 高度');

// ---------- 🥁 節奏太鼓 ----------
{
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (const diff of ['easy', 'normal', 'hard']) {
    for (const dur of [30, 60, 120]) {
      const ch = E.drumChart(diff, dur, rnd);
      ok(ch.length > 0 && ch.every(n => n.t >= 3 && n.t + n.len <= dur), `${diff} ${dur}s 譜面在時間內`);
      ok(ch.every((n, i) => i === 0 || n.t >= ch[i - 1].t), `${diff} 排序`);
      let minGap = 9; for (let i = 1; i < ch.length; i++) { const prevEnd = ch[i - 1].t + ch[i - 1].len; minGap = Math.min(minGap, ch[i].t - prevEnd); }
      ok(minGap >= 0.24, `${diff} 最小間隔 ${minGap.toFixed(3)}s`);
      ok(ch.every(n => n.k !== 'r' || n.len > 0.5), `${diff} 連打條有長度`);
      if (diff === 'easy') ok(ch.every(n => n.k !== 'r') && ch.every(n => Math.abs((n.t - 3) * 80 / 60 - Math.round((n.t - 3) * 80 / 60)) < 1e-3), '簡單只有整拍、沒有連打');
    }
  }
  const nE = E.drumChart('easy', 60, () => 0.5).length, nH = E.drumChart('hard', 60, () => 0.5).length;
  ok(nH > nE * 1.8, `困難比簡單密 ${nE} → ${nH}`);
  const ch = E.drumChart('normal', 120, () => 0.3), spb = 0.6;
  let hasRest = false; for (let i = 1; i < ch.length; i++) if (ch[i].t - (ch[i - 1].t + ch[i - 1].len) >= 4 * spb * 0.99) hasRest = true;
  ok(hasRest, '有休息小節');
  const win = E.DRUM_WIN.normal, notes = [{ t: 1, k: 's' }, { t: 1.5, k: 'b' }, { t: 2, k: 'r', len: 1 }, { t: 3.5, k: 's' }];
  let j = E.drumJudge(notes, 1.03, win); ok(j && j.idx === 0 && j.grade === 'perfect', '完美');
  j = E.drumJudge(notes, 1.13, win); ok(j && j.idx === 0 && j.grade === 'good', '不錯');
  ok(E.drumJudge(notes, 1.25, win) === null, '兩個鼓點中間不算');
  ok(E.drumJudge(notes, 1.45, win).idx === 1, '挑最近的');
  notes[1].done = true; ok(E.drumJudge(notes, 1.45, win) === null, '打過的不能再打');
  ok(E.drumJudge(notes, 2.5, win) === null, '連打條不給 drumJudge');
  ok(E.drumRollAt(notes, 2.5, win) === notes[2] && E.drumRollAt(notes, 3.3, win) === null, '連打條範圍');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
