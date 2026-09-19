import { cosine, topK, fakeUnitVector } from "../lib/vector";
import { retrievability, halfLife, updateMastery, masteryColor, DEDUP_THRESHOLD } from "../lib/memory-math";
import { buildSystemPrompt, applyStyleSignals, NEUTRAL_STYLE } from "../lib/learner";

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  -> ${detail}` : ""}`);
  if (!cond) failures++;
};

// --- vector ---
const v = fakeUnitVector("eigenvalue");
check("cosine(v,v) === 1", Math.abs(cosine(v, v) - 1) < 1e-9, cosine(v, v).toFixed(12));
check("cosine of different vectors < 1", cosine(v, fakeUnitVector("integral")) < 0.5, cosine(v, fakeUnitVector("integral")).toFixed(4));
check("fakeUnitVector is deterministic", cosine(fakeUnitVector("x"), fakeUnitVector("x")) === 1);
check("fakeUnitVector dim 768", v.length === 768);
check("cosine handles empty", cosine([], []) === 0);

const cands = ["a", "b", "c", "d"].map((s) => ({ id: s, e: fakeUnitVector(s) }));
const hits = topK(fakeUnitVector("a"), cands, (c) => c.e, 2, 0.5);
check("topK returns exact match first", hits[0]?.item.id === "a", `got ${hits[0]?.item.id}`);
check("topK respects threshold", hits.length === 1, `${hits.length} above 0.5`);

// --- decay ---
const day = 24 * 60 * 60 * 1000;
const base = { mastery: 0.9, encounterCount: 1, reviewCount: 1, lastReviewedAt: new Date() };
const now = new Date();
const r0 = retrievability(base, now);
const r7 = retrievability({ ...base, lastReviewedAt: new Date(now.getTime() - 7 * day) }, now);
const r30 = retrievability({ ...base, lastReviewedAt: new Date(now.getTime() - 30 * day) }, now);
check("retrievability falls as days rise", r0 > r7 && r7 > r30, `0d=${r0.toFixed(3)} 7d=${r7.toFixed(3)} 30d=${r30.toFixed(3)}`);
check("zero mastery stays zero", retrievability({ ...base, mastery: 0 }, now) === 0);
check("repetition extends halfLife", halfLife(3, 3) > halfLife(1, 0), `${halfLife(1,0)} -> ${halfLife(3,3)}`);

const wellDrilled = retrievability({ mastery: 0.9, encounterCount: 4, reviewCount: 4, lastReviewedAt: new Date(now.getTime() - 30 * day) }, now);
check("well-drilled concept survives 30d better", wellDrilled > r30, `${wellDrilled.toFixed(3)} > ${r30.toFixed(3)}`);

check("updateMastery moves toward score", updateMastery(0, 1) > 0 && updateMastery(1, 0) < 1, `${updateMastery(0,1).toFixed(2)} / ${updateMastery(1,0).toFixed(2)}`);
check("updateMastery clamps", updateMastery(1, 5) <= 1 && updateMastery(0, -5) >= 0);
check("masteryColor spans grey->green", masteryColor(0) !== masteryColor(1), `${masteryColor(0)} -> ${masteryColor(1)}`);

// --- learner ---
const ctx = { context: [{ title: "Eigenvalue", body: "A scalar lambda such that Av = lambda v." }] };
const tellMe = buildSystemPrompt({ ...ctx, style: { ...NEUTRAL_STYLE, socratic: 0.1 } });
const askMe = buildSystemPrompt({ ...ctx, style: { ...NEUTRAL_STYLE, socratic: 0.9 } });
check("prompt differs at socratic 0.1 vs 0.9", tellMe !== askMe);
check("socratic 0.1 says don't quiz", /do NOT quiz/i.test(tellMe));
check("socratic 0.9 says lead with a question", /Lead with a question/i.test(askMe));
check("neutral style emits no strong prefs", /No strong signal yet/.test(buildSystemPrompt({ ...ctx, style: NEUTRAL_STYLE })));
check("notes are embedded in prompt", tellMe.includes("lambda v"));

const ladder = buildSystemPrompt({ ...ctx, style: NEUTRAL_STYLE, rung: 2, stuckOn: "Eigenvalue", solidGround: ["Matrix multiplication"] });
check("rung 2 asks for an analogy from known concepts", /analogy/i.test(ladder) && /Matrix multiplication/.test(ladder));

// EMA: three consistent turns must visibly move the needle
let style = { ...NEUTRAL_STYLE };
for (let i = 0; i < 3; i++) style = applyStyleSignals(style, { socratic: 0 });
check("3 consistent turns move socratic >0.1", NEUTRAL_STYLE.socratic - style.socratic > 0.1, `0.5 -> ${style.socratic.toFixed(3)}`);
check("omitted dims are untouched", style.analogy === 0.5, `analogy=${style.analogy}`);

let drift = { ...NEUTRAL_STYLE };
for (let i = 0; i < 10; i++) drift = applyStyleSignals(drift, {});
check("empty signals never drift the profile", drift.socratic === 0.5);

console.log(`\nDEDUP_THRESHOLD = ${DEDUP_THRESHOLD}`);
console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
