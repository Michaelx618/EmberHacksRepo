// The verification that matters most: if the sliders don't move, the
// adaptive-teaching feature does not exist.
const BASE = "http://localhost:3000";

const reset = async () => {
  const { db } = await import("../lib/db");
  await db.learnerProfile.upsert({
    where: { id: "me" },
    create: {},
    update: { style: "{}", confusion: "[]", turnCount: 0 },
  });
};

async function turn(message: string) {
  const res = await fetch(`${BASE}/api/tutor`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

const fmt = (s: Record<string, number>) =>
  Object.entries(s).map(([k, v]) => `${k.slice(0, 5)}=${v.toFixed(2)}`).join("  ");

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  -> ${detail}` : ""}`);
  if (!cond) failures++;
};

// --- 1. terse, notation-heavy questions should move formalism + verbosity ---
await reset();
console.log("--- three terse, notation-heavy questions ---");
let last;
for (const m of [
  "det(A - λI) = 0 ⟹ λ ∈ spec(A)?",
  "prove tr(A) = Σλᵢ",
  "∀ symmetric A, A = QDQᵀ?",
]) {
  last = await turn(m);
  console.log("  ", fmt(last.style));
}
check("formalism rose above neutral", last.style.formalism > 0.6, last.style.formalism.toFixed(3));
check("verbosity fell below neutral", last.style.verbosity < 0.45, last.style.verbosity.toFixed(3));
check("untouched dimension stayed neutral", Math.abs(last.style.pace - 0.5) < 0.01, last.style.pace.toFixed(3));

// --- 2. "stop quizzing me" must drop socratic, fast --------------------------
await reset();
console.log('--- "just give me the answer, stop quizzing me" ---');
const r1 = await turn("just give me the answer, stop quizzing me");
console.log("  ", fmt(r1.style));
check("socratic dropped on the first request", r1.style.socratic < 0.45, r1.style.socratic.toFixed(3));

const r2 = await turn("seriously, don't quiz me, just tell me what an eigenvalue is");
console.log("  ", fmt(r2.style));
check("socratic keeps falling", r2.style.socratic < r1.style.socratic, `${r1.style.socratic.toFixed(3)} -> ${r2.style.socratic.toFixed(3)}`);
check("movement is demo-visible within 2 turns", 0.5 - r2.style.socratic > 0.15, `Δ${(0.5 - r2.style.socratic).toFixed(3)}`);

// --- 3. the opposite direction ----------------------------------------------
await reset();
const q1 = await turn("quiz me on this, let me try it myself first");
check("socratic rises for a learner who wants to be asked", q1.style.socratic > 0.55, q1.style.socratic.toFixed(3));

// --- 4. escalation ladder ---------------------------------------------------
await reset();
console.log("--- repeated confusion on one concept ---");
await turn("explain eigenvalues");
const rungs: number[] = [];
for (let i = 0; i < 3; i++) {
  const r = await turn("i still don't get it");
  rungs.push(r.rung);
  console.log(`   rung ${r.rung}  confusedAbout=${JSON.stringify(r.confusedAbout)}`);
}
check("escalation rung climbs on repeat confusion", rungs[0] < rungs[rungs.length - 1], rungs.join(" -> "));
check("stuck concept is surfaced to the UI", (await turn("i'm lost")).confusedAbout.length > 0);

// --- 5. grounding ------------------------------------------------------------
const g = await turn("what is an eigenvalue");
check("reply is grounded in the user's own notes", g.grounded.length > 0, g.grounded.join(", "));

await reset();
console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
