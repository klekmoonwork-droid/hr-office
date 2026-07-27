# ห้องฝ่ายบุคคล (hr-office)

หน้าเว็บรูปห้องออฟฟิศแบบพิกเซล — บอทแต่ละตัวคือพนักงานหนึ่งคนนั่งอยู่ที่โต๊ะ
กดที่ตัวละครแล้วจะเห็นว่าเขาทำงานล่าสุดเมื่อไหร่ งานไหนพัง และรอบถัดไปคือเมื่อไหร่

ข้อมูลมาจาก GitHub Actions ของ repo บอทจริง ๆ

## ทำงานยังไง

```
.github/workflows/snapshot.yml   ทุก 15 นาที เรียก scripts/snapshot.mjs
scripts/snapshot.mjs             ยิง GitHub API เก็บสถานะทุก repo → data/status.json แล้ว commit
index.html + assets/             หน้าเว็บ อ่าน data/status.json อย่างเดียว (ไม่มี token ในหน้าเว็บ)
bots.json                        ทะเบียนบอท: ชื่อ, หน้าที่, repo, ที่นั่ง, หน้าตา
```

หน้าเว็บเป็น static ล้วน ไม่ต้องเปิดคอมทิ้งไว้ เปิดจากมือถือได้

## ตั้งค่าครั้งแรก

1. **สร้าง Personal Access Token** — repo บอทเป็น private และเป็นคนละ repo กับอันนี้
   `GITHUB_TOKEN` ที่ Actions แจกให้อัตโนมัติจึงอ่านไม่ได้ ต้องใช้ PAT

   ไปที่ <https://github.com/settings/tokens> → **Generate new token (classic)**
   - Note: `hr-office snapshot`
   - Expiration: ตามที่สะดวก (ถ้าหมดอายุ snapshot จะหยุดอัปเดต)
   - Scopes: ติ๊ก **`repo`** อย่างเดียวพอ

2. **ใส่ token เป็น secret ของ repo นี้**
   Settings → Secrets and variables → Actions → New repository secret
   - Name: `BOTS_TOKEN`
   - Secret: token ที่เพิ่งได้

3. **เปิด GitHub Pages** — Settings → Pages → Source: `Deploy from a branch`, Branch: `main` / `(root)`

4. **สั่งรัน snapshot หนึ่งครั้ง** — แท็บ Actions → “เก็บสถานะบอท (snapshot)” → Run workflow

## เพิ่ม / แก้บอท

แก้ `bots.json` อย่างเดียว แล้ว push — snapshot จะรันใหม่ให้เอง

```json
{
  "id": "probation-due",
  "name": "ทดลองงานครบกำหนด",
  "role": "รายงานพนักงานที่ครบกำหนดทดลองงาน ส่งเข้า LINE",
  "repo": "probation-report",
  "seat": 0,
  "look": { "skin": "#f2c9a0", "hair": "#2f1c12", "hairStyle": "long", "shirt": "#7c4dff" }
}
```

- `name` ใช้ชื่องาน ไม่ใช่ชื่อเล่นคน — จะได้รู้ว่าโต๊ะนี้รับผิดชอบอะไร
- `seat` = ที่นั่ง 0–5 (แถวบนซ้าย→ขวา = 0,1,2 / แถวล่าง = 3,4,5) ห้ามซ้ำกัน
  **ที่นั่งที่ไม่มีใครจอง จะขึ้นเป็น “โต๊ะว่าง” อัตโนมัติ** (ตอนนี้ที่นั่ง 4 ว่างอยู่)
- `hairStyle` = `short` | `bob` | `long` | `bun` | `ponytail`
- ถ้าจะเพิ่มเกิน 6 คน ต้องเพิ่มพิกัดใน `SEATS` ที่ `assets/office.js` ด้วย

## อ่านห้องยังไง

ฟองเหนือหัวบอกว่าตอนนี้โต๊ะนั้นกำลังสื่ออะไร

| ฟอง | ความหมาย |
|---|---|
| ✋ ยกมือ (แดง) | มีปัญหา ต้องเข้าไปแก้ — รันล่าสุดล้มเหลว / เลยรอบมาเกิน 3 ชม. แล้วยังไม่รัน / workflow ถูกปิดอยู่ |
| ✉️ ซองจดหมาย (เขียว) | ทำงานเสร็จเรียบร้อย ส่งงานแล้ว ยังไม่มีใครเปิดอ่าน |
| 💤 Zzz (เทา) | เปิดอ่านแล้ว ตัวละครจางลง = กลับบ้านไปก่อน ป้ายบอกว่ากลับมาอีกทีวันไหน |
| ⏳ นาฬิกา | ยังไม่ถึงรอบแรก ยังไม่เคยรันเลย |
| ⋯ จุดวิ่ง (ฟ้า) | กำลังรันอยู่ตอนนี้ |

สถานะ “อ่านแล้ว” เก็บใน `localStorage` ของเบราว์เซอร์ ผูกกับ run id ล่าสุด —
**พอบอทรันรอบใหม่ ซองจดหมายจะเด้งกลับมาเอง** (เปิดคนละเครื่อง/คนละเบราว์เซอร์ จะนับแยกกัน)

## เปิดดูในเครื่อง

```bash
node scripts/snapshot.mjs   # ต้องมี GH_TOKEN (เช่น GH_TOKEN=$(gh auth token))
node scripts/serve.mjs      # แล้วเปิด http://localhost:4173
```

## ข้อมูลที่ไม่ได้เก็บ

`snapshot.mjs` **ไม่ดึงเนื้อหา log** ของ run เพราะ log ของบอท HR มีชื่อพนักงานจริง
และ repo ที่โฮสต์หน้าเว็บนี้เป็น public — `data/status.json` จึงเก็บแค่
ชื่อ workflow, ชื่อ step ที่พัง, เวลา, และลิงก์ไปหน้า run บน GitHub
ถ้าอยากเห็นข้อความ error ให้กด “เปิด log เต็มบน GitHub” ในแต่ละ panel
