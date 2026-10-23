import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const base = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const board = JSON.parse(readFileSync(resolve(base, "docs/engineering/turbo/CHECKLIST-PLANNER.json"), "utf8"));
const counts = { R1: 10, R2: 14, R3: 13, R4: 13, R5: 10 };
const allowed = new Set(["STATIC_REVIEW_COMPLETE", "BACKLOG", "READY", "ASSIGNED", "IN_PROGRESS", "IN_REVIEW", "QA_VERIFIED", "SUPERVISOR_ACCEPTED", "DONE", "BLOCKED", "REJECTED", "CANCELLED"]);
const errs = [];
const roles = new Set(Object.keys(board.roles ?? {}));
const tasks = board.tasks ?? [];
const byId = new Map(tasks.map((t) => [t.id, t]));

if (tasks.length !== 60) errs.push(`expected 60 tasks but found ${tasks.length}`);
if (byId.size !== tasks.length) errs.push("duplicate task IDs");
for (const [phase, expected] of Object.entries(counts)) {
  const selected = tasks.filter((t) => t.phase === phase);
  if (selected.length !== expected) errs.push(`${phase}: expected ${expected} tasks, found ${selected.length}`);
}
for (const t of tasks) {
  if (!/^(R[1-5])\.\d{2}$/.test(t.id)) errs.push(`${t.id}: malformed id`);
  if (!roles.has(t.owner_agent) || !roles.has(t.independent_reviewer) || !roles.has(t.qa_agent)) errs.push(`${t.id}: missing role`);
  if (t.owner_agent === t.independent_reviewer) errs.push(`${t.id}: self-reviewer`);
  if (t.owner_agent === t.qa_agent) errs.push(`${t.id}: QA cannot be the author`);
  if (t.supervisor !== "LEAD") errs.push(`${t.id}: supervisor must be LEAD`);
  if (!allowed.has(t.status)) errs.push(`${t.id}: unrecognized status ${t.status}`);
  if (!t.acceptance_criteria || !Array.isArray(t.tests) || t.tests.length === 0) errs.push(`${t.id}: missing acceptance/tests`);
  if (!Array.isArray(t.required_evidence) || !t.required_evidence.includes("independent_review") || !t.required_evidence.includes("supervisor_approval")) errs.push(`${t.id}: evidence gate absent`);
  for (const dep of t.dependencies ?? []) {
    if (!byId.has(dep) || dep === t.id) errs.push(`${t.id}: dependency ${dep} missing or self-linked`);
  }
  if (t.status === "DONE" && !t.approval_evidence?.supervisor) errs.push(`${t.id}: DONE without signed Supervisor evidence`);
}
if (errs.length) {
  errs.forEach((x) => console.error("GOVERNANCE FAIL: " + x));
  process.exitCode = 1;
} else {
  console.log("Governance PASS: 60 unique tasks, 5 phases, independent ownership/QA/review, acceptance and dependency checks.");
  console.log("This checks checklist metadata only; it does not perform live independent reviews, E2E or code approval.");
}
