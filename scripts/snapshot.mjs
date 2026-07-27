// เก็บสถานะ GitHub Actions ของบอททุกตัวมาไว้ใน data/status.json
// ตั้งใจให้รันจาก GitHub Actions (หรือรันเองในเครื่องด้วย GH_TOKEN=$(gh auth token))
//
// หมายเหตุความปลอดภัย: สคริปต์นี้ "ไม่" ดึงเนื้อหา log ของ run
// เพราะ log ของบอท HR มีชื่อพนักงานจริง และ repo ที่โฮสต์หน้าเว็บนี้เป็น public
// เก็บแค่ชื่อ step ที่พัง + ลิงก์ไปหน้า run บน GitHub

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const RUNS_PER_REPO = 15;      // ประวัติที่เก็บต่อ repo
const MAX_FAILED_DETAIL = 6;   // ดึงรายละเอียด job เฉพาะ run ที่พัง N อันล่าสุด

if (!TOKEN) {
  console.error('ต้องมี GH_TOKEN หรือ GITHUB_TOKEN');
  process.exit(1);
}

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'hr-office-snapshot',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`GET ${path} -> ${res.status} ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// ดึง cron ทั้งหมดจากไฟล์ workflow (ไม่ต้องพึ่ง yaml parser)
function extractCrons(yamlText) {
  const out = [];
  const re = /^\s*-\s*cron:\s*(?:'([^']+)'|"([^"]+)"|([^\s#]+))/gm;
  let m;
  while ((m = re.exec(yamlText)) !== null) out.push((m[1] || m[2] || m[3]).trim());
  return out;
}

async function workflowCrons(owner, repo, path) {
  try {
    const file = await gh(`/repos/${owner}/${repo}/contents/${encodeURI(path)}`);
    const text = Buffer.from(file.content || '', 'base64').toString('utf8');
    return extractCrons(text);
  } catch (e) {
    console.warn(`  อ่าน ${path} ไม่ได้: ${e.message}`);
    return [];
  }
}

async function failedSteps(owner, repo, runId) {
  try {
    const { jobs = [] } = await gh(`/repos/${owner}/${repo}/actions/runs/${runId}/jobs?per_page=20`);
    const out = [];
    for (const job of jobs) {
      if (job.conclusion === 'success' || job.conclusion === 'skipped') continue;
      for (const step of job.steps || []) {
        if (step.conclusion === 'failure' || step.conclusion === 'timed_out') {
          out.push({ job: job.name, step: step.name, conclusion: step.conclusion });
        }
      }
      if (!(job.steps || []).some((s) => s.conclusion === 'failure' || s.conclusion === 'timed_out')) {
        out.push({ job: job.name, step: null, conclusion: job.conclusion });
      }
    }
    return out;
  } catch (e) {
    console.warn(`  อ่าน jobs ของ run ${runId} ไม่ได้: ${e.message}`);
    return [];
  }
}

function durationSec(run) {
  const start = run.run_started_at || run.created_at;
  if (!start || !run.updated_at) return null;
  const d = (new Date(run.updated_at) - new Date(start)) / 1000;
  return d >= 0 && d < 60 * 60 * 24 ? Math.round(d) : null;
}

async function collectBot(owner, bot) {
  const repo = bot.repo;
  console.log(`เก็บข้อมูล ${owner}/${repo} ...`);
  const result = { id: bot.id, repo, repoUrl: `https://github.com/${owner}/${repo}`, workflows: [], runs: [], error: null };

  let workflows = [];
  try {
    const data = await gh(`/repos/${owner}/${repo}/actions/workflows?per_page=50`);
    workflows = data.workflows || [];
  } catch (e) {
    result.error = e.status === 404 ? 'ไม่พบ repo หรือ token ไม่มีสิทธิ์เข้าถึง' : e.message;
    return result;
  }

  for (const wf of workflows) {
    result.workflows.push({
      id: wf.id,
      name: wf.name,
      path: wf.path,
      state: wf.state, // active | disabled_manually | disabled_inactivity ...
      url: wf.html_url,
      crons: await workflowCrons(owner, repo, wf.path),
    });
  }

  let runs = [];
  try {
    const data = await gh(`/repos/${owner}/${repo}/actions/runs?per_page=${RUNS_PER_REPO}`);
    runs = data.workflow_runs || [];
  } catch (e) {
    result.error = e.message;
    return result;
  }

  result.runs = runs.map((run) => ({
    id: run.id,
    workflowId: run.workflow_id,
    workflow: run.name,
    title: run.display_title,
    status: run.status,           // queued | in_progress | completed
    conclusion: run.conclusion,   // success | failure | cancelled | ...
    event: run.event,             // schedule | workflow_dispatch | push
    startedAt: run.run_started_at || run.created_at,
    finishedAt: run.updated_at,
    durationSec: durationSec(run),
    attempt: run.run_attempt,
    url: run.html_url,
    failed: [],
  }));

  const broken = result.runs.filter((r) => r.conclusion === 'failure' || r.conclusion === 'timed_out').slice(0, MAX_FAILED_DETAIL);
  for (const run of broken) run.failed = await failedSteps(owner, repo, run.id);

  return result;
}

const config = JSON.parse(await readFile(resolve(ROOT, 'bots.json'), 'utf8'));
const snapshot = {
  generatedAt: new Date().toISOString(),
  owner: config.owner,
  roomTitle: config.roomTitle,
  bots: [],
};

for (const bot of config.bots) {
  const data = await collectBot(config.owner, bot);
  snapshot.bots.push({ ...bot, ...data });
}

await mkdir(resolve(ROOT, 'data'), { recursive: true });
await writeFile(resolve(ROOT, 'data', 'status.json'), JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
console.log(`\nเขียน data/status.json แล้ว (${snapshot.bots.length} บอท)`);
