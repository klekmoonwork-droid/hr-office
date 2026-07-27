/* ห้องฝ่ายบุคคล — แสดงสถานะบอท GitHub Actions เป็นตัวละครในออฟฟิศ */
'use strict';

const ROOM_W = 448;
const ROOM_H = 288;
const TZ = 'Asia/Bangkok';

/* ตำแหน่งโต๊ะ 6 ที่ (พิกัดในห้อง หน่วย px) */
const SEATS = [
  { x: 96, y: 104 }, { x: 224, y: 104 }, { x: 352, y: 104 },
  { x: 96, y: 208 }, { x: 224, y: 208 }, { x: 352, y: 208 },
];

const STATE = {
  ok:      { color: '#3ddc84', label: 'ทำงานปกติ' },
  fail:    { color: '#ff5d5d', label: 'งานพัง' },
  late:    { color: '#ffb020', label: 'ไม่ได้รันตามรอบ' },
  running: { color: '#4ea8ff', label: 'กำลังทำงาน' },
  off:     { color: '#6f788f', label: 'ปิดใช้งานอยู่' },
  never:   { color: '#9aa3bb', label: 'ยังไม่เคยรัน' },
  error:   { color: '#ff5d5d', label: 'อ่านข้อมูลไม่ได้' },
};

/* ============================ cron ============================ */

function parseField(field, min, max) {
  const set = new Set();
  for (const part of String(field).split(',')) {
    const [range, stepRaw] = part.split('/');
    const step = stepRaw ? parseInt(stepRaw, 10) : 1;
    if (!step || step < 1) continue;
    let lo, hi;
    if (range === '*') { lo = min; hi = max; }
    else if (range.includes('-')) {
      const [a, b] = range.split('-');
      lo = parseInt(a, 10); hi = parseInt(b, 10);
    } else { lo = hi = parseInt(range, 10); }
    if (Number.isNaN(lo) || Number.isNaN(hi)) continue;
    for (let v = lo; v <= hi; v += step) set.add(v);
  }
  return set;
}

/** แปลง cron 5 ช่อง (UTC) เป็นออบเจกต์ที่เทียบวันเวลาได้ */
function parseCron(expr) {
  const f = String(expr).trim().split(/\s+/);
  if (f.length !== 5) return null;
  const dow = parseField(f[4], 0, 7);
  if (dow.has(7)) { dow.delete(7); dow.add(0); }
  return {
    expr,
    minute: parseField(f[0], 0, 59),
    hour: parseField(f[1], 0, 23),
    dom: parseField(f[2], 1, 31),
    month: parseField(f[3], 1, 12),
    dow,
    domAny: f[2] === '*',
    dowAny: f[4] === '*',
  };
}

function dayMatches(c, d) {
  if (!c.month.has(d.getUTCMonth() + 1)) return false;
  const domHit = c.dom.has(d.getUTCDate());
  const dowHit = c.dow.has(d.getUTCDay());
  if (c.domAny && c.dowAny) return true;
  if (c.domAny) return dowHit;
  if (c.dowAny) return domHit;
  return domHit || dowHit; // cron มาตรฐาน: ถ้าระบุทั้งคู่ ใช้ OR
}

/** คืนเวลารันถัดไปตาม cron ตั้งแต่ `from` (ไม่รวม from) จำนวน count ครั้ง */
function nextRuns(cron, from, count = 1) {
  const c = typeof cron === 'string' ? parseCron(cron) : cron;
  if (!c) return [];
  const out = [];
  const hours = [...c.hour].sort((a, b) => a - b);
  const minutes = [...c.minute].sort((a, b) => a - b);
  const day = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  for (let i = 0; i < 400 && out.length < count; i++) {
    if (dayMatches(c, day)) {
      for (const h of hours) {
        for (const m of minutes) {
          const t = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, m));
          if (t > from) { out.push(t); if (out.length >= count) break; }
        }
        if (out.length >= count) break;
      }
    }
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return out;
}

/** เวลารันตามรอบ "ครั้งล่าสุดที่ควรเกิดขึ้น" ก่อน `before` */
function prevRun(cron, before) {
  const c = typeof cron === 'string' ? parseCron(cron) : cron;
  if (!c) return null;
  const hours = [...c.hour].sort((a, b) => b - a);
  const minutes = [...c.minute].sort((a, b) => b - a);
  const day = new Date(Date.UTC(before.getUTCFullYear(), before.getUTCMonth(), before.getUTCDate()));
  for (let i = 0; i < 400; i++) {
    if (dayMatches(c, day)) {
      for (const h of hours) {
        for (const m of minutes) {
          const t = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, m));
          if (t < before) return t;
        }
      }
    }
    day.setUTCDate(day.getUTCDate() - 1);
  }
  return null;
}

const TH_DOW = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

const bkkParts = (() => {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return (d) => {
    const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
    return { dow: dowMap[p.weekday], day: +p.day, hhmm: `${p.hour}:${p.minute}` };
  };
})();

/** อธิบายตาราง cron เป็นภาษาไทย โดยอ่านค่าจริงจากรอบถัดไป (เลี่ยงบั๊กแปลง timezone เอง) */
function describeCron(expr) {
  const c = parseCron(expr);
  if (!c) return expr;
  const samples = nextRuns(c, new Date(), 24).map(bkkParts);
  if (!samples.length) return expr;

  const times = [...new Set(samples.map((s) => s.hhmm))].sort();
  const timeText = times.length <= 3 ? `เวลา ${times.join(', ')} น.` : `วันละ ${times.length} รอบ`;

  if (!c.domAny) {
    const days = [...new Set(samples.map((s) => s.day))].sort((a, b) => a - b);
    const compact = days.length > 3 && days[days.length - 1] - days[0] === days.length - 1
      ? `${days[0]}–${days[days.length - 1]}`
      : days.join(', ');
    return `ทุกวันที่ ${compact} ของเดือน ${timeText}`;
  }
  if (!c.dowAny) {
    const dows = [...new Set(samples.map((s) => s.dow))].sort((a, b) => a - b);
    if (dows.length === 5 && dows.every((d) => d >= 1 && d <= 5)) return `ทุกวันจันทร์–ศุกร์ ${timeText}`;
    if (dows.length === 7) return `ทุกวัน ${timeText}`;
    return `ทุกวัน${dows.map((d) => TH_DOW[d]).join(', ')} ${timeText}`;
  }
  return `ทุกวัน ${timeText}`;
}

/* ============================ วันเวลา ============================ */

const fmtFull = new Intl.DateTimeFormat('th-TH', {
  timeZone: TZ, dateStyle: 'medium', timeStyle: 'short',
});

function thaiDate(iso) {
  if (!iso) return '—';
  return fmtFull.format(new Date(iso)) + ' น.';
}

function relative(iso, now = Date.now()) {
  if (!iso) return '';
  const diff = now - new Date(iso).getTime();
  const future = diff < 0;
  const s = Math.abs(diff) / 1000;
  const pick = () => {
    if (s < 60) return 'ไม่ถึงนาที';
    if (s < 3600) return `${Math.round(s / 60)} นาที`;
    if (s < 86400) return `${Math.round(s / 3600)} ชั่วโมง`;
    if (s < 86400 * 30) return `${Math.round(s / 86400)} วัน`;
    if (s < 86400 * 365) return `${Math.round(s / 86400 / 30)} เดือน`;
    return `${Math.round(s / 86400 / 365)} ปี`;
  };
  return future ? `อีก ${pick()}` : `${pick()}ที่แล้ว`;
}

function duration(sec) {
  if (sec == null) return '—';
  if (sec < 60) return `${sec} วิ`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m} นาที ${s} วิ` : `${m} นาที`;
}

const EVENT_TH = {
  schedule: 'ตามรอบเวลา',
  workflow_dispatch: 'สั่งรันเอง',
  push: 'push โค้ด',
  repository_dispatch: 'ถูกเรียกจากภายนอก',
};

function runTone(run) {
  if (run.status !== 'completed') return 'running';
  if (run.conclusion === 'success') return 'ok';
  if (run.conclusion === 'failure' || run.conclusion === 'timed_out') return 'fail';
  return 'late';
}

const CONCLUSION_TH = {
  success: 'สำเร็จ', failure: 'ล้มเหลว', cancelled: 'ถูกยกเลิก',
  timed_out: 'หมดเวลา', skipped: 'ข้าม', startup_failure: 'เริ่มไม่ขึ้น',
};

/* ============================ วิเคราะห์สถานะบอท ============================ */

const MISS_GRACE_MS = 3 * 60 * 60 * 1000; // เลยรอบเกิน 3 ชม. แล้วยังไม่รัน = พลาดรอบ

function analyse(bot, now = new Date()) {
  const workflows = (bot.workflows || []).map((wf) => {
    const runs = (bot.runs || []).filter((r) => r.workflowId === wf.id);
    const last = runs[0] || null;
    const cron = (wf.crons || [])[0] || null;
    const enabled = wf.state === 'active';

    let next = null, missed = null;
    if (cron && enabled) {
      next = nextRuns(cron, now, 1)[0] || null;
      const due = prevRun(cron, now);
      if (due && now - due > MISS_GRACE_MS) {
        const ranSince = last && new Date(last.startedAt) >= new Date(due.getTime() - 60 * 60 * 1000);
        if (!ranSince) missed = due;
      }
    }

    let tone;
    if (!enabled) tone = 'off';
    else if (!last) tone = 'never';
    else if (last.status !== 'completed') tone = 'running';
    else if (last.conclusion === 'failure' || last.conclusion === 'timed_out') tone = 'fail';
    else if (missed) tone = 'late';
    else tone = 'ok';

    return { ...wf, runs, last, cron, enabled, next, missed, tone };
  });

  let tone;
  if (bot.error) tone = 'error';
  else if (!workflows.length) tone = 'never';
  else if (workflows.some((w) => w.tone === 'fail')) tone = 'fail';
  else if (workflows.some((w) => w.tone === 'running')) tone = 'running';
  else if (workflows.some((w) => w.tone === 'late')) tone = 'late';
  else if (workflows.every((w) => !w.enabled)) tone = 'off';
  else if (workflows.every((w) => !w.last)) tone = 'never';
  else tone = 'ok';

  const lastRun = (bot.runs || [])[0] || null;
  const upcoming = workflows.filter((w) => w.next).sort((a, b) => a.next - b.next)[0] || null;

  return { ...bot, workflows, tone, lastRun, upcoming };
}

/* ============================ วาดห้อง ============================ */

const cv = document.getElementById('room');
const ctx = cv.getContext('2d');

function px(x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x | 0, y | 0, w | 0, h | 0);
}

function drawFloor() {
  px(0, 0, ROOM_W, ROOM_H, '#8a5a34');
  for (let y = 44; y < ROOM_H; y += 18) {
    px(0, y, ROOM_W, 1, '#7d4d28');
    px(0, y + 1, ROOM_W, 1, '#93603a');
    const offset = ((y / 18) % 3) * 112;
    for (let x = offset; x < ROOM_W; x += 336) px(x, y + 2, 1, 16, '#82532d');
  }
}

function drawWall() {
  px(0, 0, ROOM_W, 44, '#e7e0d4');          // ผนัง
  px(0, 0, ROOM_W, 6, '#cfc5b3');           // คิ้วบน
  px(0, 6, ROOM_W, 1, '#b8ac97');
  px(0, 38, ROOM_W, 6, '#6a4123');          // บัวเชิงผนัง
  px(0, 38, ROOM_W, 1, '#8a5a34');

  // ไวท์บอร์ด
  px(20, 8, 86, 28, '#3b3f4d');
  px(22, 10, 82, 24, '#fbfbf7');
  px(27, 15, 38, 2, '#5a2f9b');
  px(27, 20, 54, 2, '#b9bcc7');
  px(27, 25, 30, 2, '#b9bcc7');
  px(27, 30, 44, 2, '#b9bcc7');
  px(86, 14, 14, 14, '#e5d5f5');

  // ป้ายชื่อห้อง (ข้อความวางทับด้วย DOM)
  px(176, 10, 96, 22, '#8a5a34');
  px(178, 12, 92, 18, '#f6efe1');

  // นาฬิกา
  px(290, 12, 18, 18, '#3b3f4d');
  px(292, 14, 14, 14, '#fbfbf7');
  px(298, 17, 2, 5, '#3b3f4d');
  px(298, 21, 5, 2, '#3b3f4d');

  // หน้าต่าง
  for (const wx of [330, 392]) {
    px(wx, 8, 52, 28, '#4b5566');
    px(wx + 2, 10, 48, 24, '#9fd6ef');
    px(wx + 2, 10, 48, 9, '#bde6f7');
    px(wx + 25, 10, 2, 24, '#4b5566');
    px(wx + 2, 21, 48, 2, '#4b5566');
  }
}

function drawRug(x, y, w, h) {
  for (let i = 2; i < h - 2; i += 5) {                   // ชายพรม
    px(x - 3, y + i, 3, 3, '#cfc0e8');
    px(x + w, y + i, 3, 3, '#cfc0e8');
  }
  px(x, y, w, h, '#3f2b63');
  px(x + 2, y + 2, w - 4, h - 4, '#553a80');
  px(x + 6, y + 5, w - 12, 2, '#9d86c9');
  px(x + 6, y + h - 7, w - 12, 2, '#9d86c9');
  px(x + 12, y + 9, w - 24, h - 18, '#4a3270');
  px(x + w / 2 - 12, y + h / 2 - 4, 24, 8, '#6b4a9e');
  px(x + w / 2 - 6, y + h / 2 - 2, 12, 4, '#9d86c9');
}

function drawPlant(x, y) {
  px(x + 3, y + 14, 13, 11, '#a2542e');
  px(x + 3, y + 14, 13, 2, '#c4703f');
  px(x + 8, y + 5, 2, 10, '#2f6b3a');
  px(x + 1, y + 3, 7, 7, '#3f8a4c');
  px(x + 10, y, 8, 8, '#4d9c58');
  px(x + 4, y + 8, 9, 6, '#3f8a4c');
  px(x, y + 25, 19, 2, 'rgba(0,0,0,.20)');
}

function drawCooler(x, y) {
  px(x, y, 14, 12, '#7fd4ef');
  px(x + 2, y + 2, 10, 8, '#bdeaf8');
  px(x, y + 12, 14, 20, '#e6e9ef');
  px(x + 4, y + 18, 6, 3, '#8d94a6');
  px(x, y + 32, 14, 2, 'rgba(0,0,0,.20)');
}

function drawCabinet(x, y) {
  px(x, y, 20, 32, '#7d8497');
  px(x, y, 20, 2, '#99a0b2');
  for (let i = 0; i < 3; i++) {
    px(x + 2, y + 3 + i * 10, 16, 8, '#646b7d');
    px(x + 7, y + 6 + i * 10, 6, 2, '#c3c9d6');
  }
  px(x, y + 32, 20, 2, 'rgba(0,0,0,.20)');
}

function drawPrinter(x, y) {
  px(x, y + 4, 24, 16, '#5c6373');
  px(x + 2, y, 20, 5, '#f3efe4');
  px(x + 3, y + 8, 18, 4, '#2f3542');
  px(x + 4, y + 14, 16, 5, '#f3efe4');
  px(x, y + 20, 24, 2, 'rgba(0,0,0,.20)');
}

function drawSofa(x, y) {
  px(x, y, 52, 20, '#3e4a63');
  px(x, y, 52, 7, '#4d5b78');
  px(x + 2, y + 7, 23, 11, '#5b6b8c');
  px(x + 27, y + 7, 23, 11, '#5b6b8c');
  px(x, y + 20, 52, 2, 'rgba(0,0,0,.22)');
}

function drawTable(x, y) {
  px(x, y, 26, 10, '#a9754a');
  px(x, y, 26, 2, '#c58f5c');
  px(x + 8, y + 2, 10, 4, '#f3efe4');
  px(x + 2, y + 10, 3, 6, '#6a4123');
  px(x + 21, y + 10, 3, 6, '#6a4123');
  px(x, y + 16, 26, 2, 'rgba(0,0,0,.20)');
}

function drawMeetingTable(x, y) {
  for (const cx of [x + 10, x + 40, x + 70]) {          // เก้าอี้แถวหลัง
    px(cx, y - 10, 12, 10, '#4a5468');
    px(cx, y - 10, 12, 3, '#5c6880');
  }
  px(x, y, 82, 4, '#c58f5c');                            // โต๊ะประชุม
  px(x, y + 4, 82, 12, '#a9754a');
  px(x, y + 16, 82, 4, '#7d5330');
  px(x + 5, y + 20, 4, 7, '#6a4123');
  px(x + 73, y + 20, 4, 7, '#6a4123');
  px(x + 12, y + 7, 14, 6, '#f3efe4');                   // เอกสารบนโต๊ะ
  px(x + 34, y + 7, 8, 6, '#ffffff');
  px(x + 56, y + 6, 6, 8, '#8a5a34');
  px(x + 3, y + 27, 76, 2, 'rgba(0,0,0,.18)');
  for (const cx of [x + 22, x + 52]) {                   // เก้าอี้แถวหน้า
    px(cx, y + 22, 12, 8, '#4a5468');
    px(cx, y + 22, 12, 3, '#5c6880');
  }
}

function drawCoffee(x, y) {
  px(x + 3, y - 4, 12, 4, '#6b7280');
  px(x, y, 18, 22, '#42474f');
  px(x + 3, y + 3, 12, 8, '#20242b');
  px(x + 5, y + 14, 8, 5, '#8a5a34');
  px(x, y + 22, 18, 2, 'rgba(0,0,0,.22)');
}

/** ตัวละคร 20x34 นั่งอยู่หลังโต๊ะ (ท่อนล่างจะถูกโต๊ะบัง) */
function drawPerson(cx, topY, look, bob) {
  const x = cx - 10;
  const y = topY + bob;
  const { skin, hair, shirt, hairStyle } = look;

  px(x + 2, y + 18, 16, 16, shirt);                    // ลำตัว
  px(x + 2, y + 18, 16, 2, '#ffffff26');
  px(x, y + 20, 3, 11, shirt);                         // แขนซ้าย
  px(x + 17, y + 20, 3, 11, shirt);                    // แขนขวา
  px(x, y + 20, 3, 11, 'rgba(0,0,0,.16)');
  px(x + 17, y + 20, 3, 11, 'rgba(0,0,0,.16)');
  px(x + 8, y + 21, 4, 13, '#ffffff2b');               // สาบเสื้อ
  px(x + 8, y + 16, 4, 3, skin);                       // คอ
  px(x + 8, y + 18, 4, 1, 'rgba(0,0,0,.18)');

  px(x + 4, y + 2, 12, 14, skin);                      // หัว
  px(x + 4, y + 13, 12, 3, 'rgba(0,0,0,.10)');
  px(x + 7, y + 8, 2, 2, '#2b2b2b');                   // ตา
  px(x + 11, y + 8, 2, 2, '#2b2b2b');
  px(x + 6, y + 10, 1, 1, 'rgba(224,120,120,.5)');     // แก้ม
  px(x + 13, y + 10, 1, 1, 'rgba(224,120,120,.5)');
  px(x + 9, y + 12, 2, 1, 'rgba(0,0,0,.35)');          // ปาก

  px(x + 4, y, 12, 5, hair);                           // ผม
  px(x + 3, y + 2, 2, 6, hair);
  px(x + 15, y + 2, 2, 6, hair);
  if (hairStyle === 'long')     { px(x + 2, y + 4, 3, 15, hair); px(x + 15, y + 4, 3, 15, hair); }
  if (hairStyle === 'bob')      { px(x + 2, y + 4, 3, 9, hair);  px(x + 15, y + 4, 3, 9, hair); }
  if (hairStyle === 'bun')      { px(x + 7, y - 4, 6, 5, hair); }
  if (hairStyle === 'ponytail') { px(x + 15, y + 4, 4, 17, hair); }
}

/** โต๊ะทำงาน วาดทับตัวละครให้ดูเหมือนนั่งอยู่ */
function drawDesk(cx, topY, screenColor) {
  const L = cx - 32, W = 64;
  px(L, topY, W, 3, '#c58f5c');            // ขอบโต๊ะ
  px(L, topY + 3, W, 11, '#a9754a');       // หน้าโต๊ะ
  px(L, topY + 14, W, 5, '#7d5330');       // สันโต๊ะ
  px(L + 3, topY + 19, 4, 9, '#6a4123');   // ขา
  px(L + W - 7, topY + 19, 4, 9, '#6a4123');
  px(L + 1, topY + 28, 8, 2, 'rgba(0,0,0,.18)');
  px(L + W - 9, topY + 28, 8, 2, 'rgba(0,0,0,.18)');

  px(cx - 31, topY - 13, 18, 13, '#2b3040');   // จอ (อยู่ข้าง ไม่บังหน้า)
  px(cx - 29, topY - 11, 14, 9, screenColor);
  px(cx - 29, topY - 11, 14, 2, '#ffffff33');
  px(cx - 24, topY, 4, 2, '#2b3040');
  px(cx - 27, topY + 2, 10, 2, '#3b4152');

  px(cx - 30, topY + 6, 16, 4, '#d7dbe4');     // คีย์บอร์ด
  px(cx - 30, topY + 6, 16, 1, '#eef1f6');

  px(cx + 15, topY + 3, 6, 8, '#ffffff');      // แก้วกาแฟ
  px(cx + 15, topY + 3, 6, 2, '#8a5a34');
  px(cx + 21, topY + 5, 2, 3, '#e2e6ee');
  px(cx + 24, topY + 5, 8, 6, '#f3efe4');      // กองเอกสาร
  px(cx + 24, topY + 5, 8, 1, '#d9d2c1');
}

const seatButtons = new Map();
let bots = [];
let frame = 0;

function drawRoom() {
  ctx.imageSmoothingEnabled = false;
  drawFloor();
  // พรมวางมุมขวาล่าง — เลี่ยงแถบกลางห้องที่ป้ายชื่อแถวล่างลอยอยู่
  drawRug(296, 238, 108, 40);
  drawWall();

  drawCabinet(6, 54);
  drawPrinter(4, 152);
  drawPlant(6, 244);
  drawCooler(428, 54);
  drawPlant(424, 148);
  drawCoffee(422, 246);
  drawSofa(30, 248);
  drawTable(88, 256);
  drawMeetingTable(180, 248);
  drawPlant(144, 146);     // ต้นไม้กลางห้อง วางเยื้องจากป้ายชื่อ
  drawPlant(274, 146);

  bots.forEach((bot, i) => {
    const seat = SEATS[bot.seat ?? i];
    if (!seat) return;
    const tone = STATE[bot.tone] || STATE.never;
    const bob = bot.tone === 'running' ? Math.round(Math.sin(frame / 9 + i) * 1.5) : Math.round(Math.sin(frame / 26 + i * 1.7));
    drawPerson(seat.x, seat.y - 30, bot.look, bob);
    drawDesk(seat.x, seat.y, tone.color);
  });
}

function loop() {
  frame++;
  drawRoom();
  requestAnimationFrame(loop);
}

/* ============================ overlay ตัวละคร ============================ */

const overlay = document.getElementById('overlay');

function buildSeats() {
  for (const btn of seatButtons.values()) btn.remove();
  seatButtons.clear();

  bots.forEach((bot, i) => {
    const seat = SEATS[bot.seat ?? i];
    if (!seat) return;
    const tone = STATE[bot.tone] || STATE.never;

    const btn = document.createElement('button');
    btn.className = 'seat';
    btn.dataset.state = bot.tone;
    btn.style.left = `${(seat.x / ROOM_W) * 100}%`;
    btn.style.top = `${((seat.y - 45) / ROOM_H) * 100}%`;
    btn.title = `${bot.name} — ${tone.label}`;
    btn.innerHTML = `
      <span class="tag"><span class="dot" style="background:${tone.color}"></span>${bot.name}</span>
      <span class="hitbox"></span>`;
    btn.addEventListener('click', () => openPanel(bot.id));
    overlay.appendChild(btn);
    seatButtons.set(bot.id, btn);
  });
}

/* ============================ panel ============================ */

const panel = document.getElementById('panel');
const panelBody = document.getElementById('panel-body');
const scrim = document.getElementById('scrim');

function closePanel() {
  panel.hidden = true;
  scrim.hidden = true;
  for (const b of seatButtons.values()) b.classList.remove('is-active');
}

document.getElementById('panel-close').addEventListener('click', closePanel);
scrim.addEventListener('click', closePanel);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanel(); });

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function runRow(run) {
  const tone = STATE[runTone(run)];
  const label = run.status !== 'completed'
    ? 'กำลังรัน'
    : (CONCLUSION_TH[run.conclusion] || run.conclusion || '—');
  const failed = (run.failed || []).map((f) => f.step || f.job).filter(Boolean);
  return `
    <a class="run" href="${esc(run.url)}" target="_blank" rel="noopener">
      <span class="dot" style="background:${tone.color}"></span>
      <span>
        <span class="main">${esc(run.workflow || run.title || 'workflow')}</span>
        <span class="sub">${label} · ${esc(EVENT_TH[run.event] || run.event)} · ${esc(relative(run.startedAt))}${
          failed.length ? ` · พังที่ “${esc(failed[0])}”` : ''}</span>
      </span>
      <span class="right">${esc(thaiDate(run.startedAt))}<br>${esc(duration(run.durationSec))}</span>
    </a>`;
}

function troubleBlock(bot) {
  const broken = bot.workflows.filter((w) => w.tone === 'fail');
  const late = bot.workflows.filter((w) => w.missed); // แจ้งแม้ตอนที่ล่าสุดจะพังด้วย
  const off = bot.workflows.filter((w) => !w.enabled);
  let html = '';

  for (const w of broken) {
    const steps = (w.last.failed || []).map((f) => `<li>${esc(f.job)}${f.step ? ` → ขั้นตอน “${esc(f.step)}”` : ''}</li>`).join('');
    html += `<div class="alert">
      <b>“${esc(w.name)}” ล้มเหลว</b>
      รันล่าสุด ${esc(thaiDate(w.last.startedAt))} (${esc(relative(w.last.startedAt))})
      ${steps ? `<ul>${steps}</ul>` : ''}
      <a href="${esc(w.last.url)}" target="_blank" rel="noopener">เปิด log เต็มบน GitHub →</a>
    </div>`;
  }
  for (const w of late) {
    html += `<div class="alert warn">
      <b>“${esc(w.name)}” ไม่ได้รันตามรอบ</b>
      ควรรันเมื่อ ${esc(thaiDate(w.missed.toISOString()))} (${esc(relative(w.missed.toISOString()))}) แต่ยังไม่มี run
    </div>`;
  }
  for (const w of off) {
    const why = w.state === 'disabled_inactivity'
      ? 'GitHub ปิดให้อัตโนมัติเพราะ repo ไม่มีความเคลื่อนไหวเกิน 60 วัน'
      : 'ถูกปิดด้วยมือจากหน้า Actions';
    html += `<div class="alert warn">
      <b>“${esc(w.name)}” ปิดใช้งานอยู่</b>${esc(why)} — ตอนนี้ไม่ทำงานตามรอบ
    </div>`;
  }
  if (bot.error) {
    html += `<div class="alert"><b>อ่านข้อมูล repo ไม่ได้</b>${esc(bot.error)}</div>`;
  }
  return html;
}

function openPanel(id) {
  const bot = bots.find((b) => b.id === id);
  if (!bot) return;
  const tone = STATE[bot.tone] || STATE.never;
  const last = bot.lastRun;

  const facts = `
    <div class="facts">
      <div class="fact">
        <div class="k">ทำงานครั้งล่าสุด</div>
        <div class="v">${last ? esc(relative(last.startedAt)) : 'ยังไม่เคย'}</div>
        <div class="s">${last ? esc(thaiDate(last.startedAt)) : '—'}</div>
      </div>
      <div class="fact">
        <div class="k">ผลครั้งล่าสุด</div>
        <div class="v" style="color:${last ? STATE[runTone(last)].color : 'inherit'}">${
          last ? esc(last.status !== 'completed' ? 'กำลังรัน' : (CONCLUSION_TH[last.conclusion] || last.conclusion)) : '—'}</div>
        <div class="s">${last ? `ใช้เวลา ${esc(duration(last.durationSec))} · ${esc(EVENT_TH[last.event] || last.event)}` : '—'}</div>
      </div>
      <div class="fact wide">
        <div class="k">รอบถัดไป</div>
        <div class="v">${bot.upcoming ? esc(thaiDate(bot.upcoming.next.toISOString())) : 'ไม่มีรอบอัตโนมัติ'}</div>
        <div class="s">${bot.upcoming ? `${esc(bot.upcoming.name)} · ${esc(relative(bot.upcoming.next.toISOString()))}` : 'ต้องสั่งรันเองจากหน้า Actions'}</div>
      </div>
    </div>`;

  const wfList = bot.workflows.length ? bot.workflows.map((w) => `
    <div class="wf">
      <div class="wf-name"><span class="dot" style="background:${STATE[w.tone].color}"></span>${esc(w.name)}</div>
      <div class="wf-meta">
        ${w.cron ? esc(describeCron(w.cron)) : 'ไม่มีตารางอัตโนมัติ'}<br>
        ${w.enabled ? 'เปิดใช้งาน' : 'ปิดใช้งาน'} · ${w.runs.length ? `รันแล้ว ${w.runs.length} ครั้งใน 15 รันล่าสุด` : 'ยังไม่มีประวัติรัน'}
      </div>
    </div>`).join('') : '<p class="empty">ยังไม่มี workflow ใน repo นี้</p>';

  const runs = (bot.runs || []).length
    ? `<div class="runs">${bot.runs.map(runRow).join('')}</div>`
    : '<p class="empty">ยังไม่เคยรันเลยสักครั้ง</p>';

  panelBody.innerHTML = `
    <div class="who">
      <h2>${esc(bot.name)}</h2>
      <span class="badge" style="background:${tone.color}22;color:${tone.color}">${esc(tone.label)}</span>
    </div>
    <p class="who-role">${esc(bot.role)}</p>
    <p class="who-repo"><a href="${esc(bot.repoUrl)}" target="_blank" rel="noopener">${esc(bot.repo)}</a></p>
    ${troubleBlock(bot)}
    ${facts}
    <div class="sec-title">งานที่รับผิดชอบ</div>
    ${wfList}
    <div class="sec-title">ประวัติการทำงานล่าสุด</div>
    ${runs}
    <a class="gh-link" href="${esc(bot.repoUrl)}/actions" target="_blank" rel="noopener">เปิดหน้า Actions บน GitHub →</a>`;

  panel.hidden = false;
  scrim.hidden = false;
  panel.scrollTop = 0;
  for (const [bid, b] of seatButtons) b.classList.toggle('is-active', bid === id);
}

/* ============================ สรุปหัวหน้าจอ ============================ */

function renderSummary(snapshot) {
  document.getElementById('room-title').textContent = snapshot.roomTitle || 'ห้องฝ่ายบุคคล';
  document.getElementById('wall-sign').textContent = snapshot.roomTitle || 'ฝ่ายบุคคล';
  document.getElementById('stamp').textContent =
    `ข้อมูล ณ ${thaiDate(snapshot.generatedAt)} (${relative(snapshot.generatedAt)})`;

  const counts = {};
  for (const b of bots) counts[b.tone] = (counts[b.tone] || 0) + 1;
  const order = ['fail', 'late', 'running', 'off', 'never', 'error', 'ok'];
  document.getElementById('summary-chips').innerHTML = order
    .filter((k) => counts[k])
    .map((k) => `<span class="chip"><span class="dot" style="background:${STATE[k].color}"></span>${STATE[k].label} <b>${counts[k]}</b></span>`)
    .join('');
}

/* ============================ start ============================ */

(async function start() {
  let snapshot;
  try {
    const res = await fetch(`data/status.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    snapshot = await res.json();
  } catch (e) {
    document.getElementById('stamp').textContent = 'โหลด data/status.json ไม่ได้';
    document.querySelector('.hint').textContent =
      'ยังไม่มีไฟล์ data/status.json — ให้ workflow "snapshot" รันหนึ่งครั้งก่อน';
    return;
  }

  const now = new Date();
  bots = (snapshot.bots || []).map((b) => analyse(b, now));
  renderSummary(snapshot);
  buildSeats();
  loop();
})();
