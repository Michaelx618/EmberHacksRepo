// Phase 2 verification. The critical one: re-reading a topic must STRENGTHEN
// the concept you already have, not duplicate it.
import "../lib/load-env";
import { db } from "../lib/db";
import { consolidate, retrieve, weakPrerequisitesFor, solidGround } from "../lib/memory";
import { embedOne } from "../lib/gemini";
import { hashEmbed } from "../lib/vector";

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  -> ${detail}` : ""}`);
  if (!cond) failures++;
};

const note = async (title: string) =>
  (await db.note.create({ data: { title, sourceType: "text", markdown: `# ${title}` } })).id;

const before = await db.concept.count();

// ---- 1. REINFORCE: same idea, different words ------------------------------
const n1 = await note("TEST Lecture 1");
const n2 = await note("TEST Lecture 2");

const original = {
  title: "Photosynthesis",
  summary: "Plants convert light into chemical energy.",
  body: "Photosynthesis is the process by which plants convert light energy into chemical energy stored as glucose, using carbon dioxide and water and releasing oxygen.",
  kind: "definition",
};
const restated = {
  title: "Photosynthesis",
  summary: "Plants convert light energy into chemical energy.",
  body: "Photosynthesis is the process by which plants convert light energy into chemical energy stored as glucose, using carbon dioxide and water and releasing oxygen as a byproduct.",
  kind: "definition",
};

await consolidate(n1, [original]);
const r2 = await consolidate(n2, [restated]);

const photo = await db.concept.findMany({
  where: { title: "Photosynthesis" },
  include: { sources: true },
});

check("re-reading creates ONE concept, not two", photo.length === 1, `${photo.length} concepts`);
check("encounterCount reached 2", photo[0]?.encounterCount === 2, `got ${photo[0]?.encounterCount}`);
check("two ConceptSource rows (both notes)", photo[0]?.sources.length === 2, `got ${photo[0]?.sources.length}`);
check("outcome reported as reinforce/supersede", ["reinforced", "superseded"].includes(r2.outcomes[0]?.action), r2.outcomes[0]?.action);

// ---- 2. DISTINCT: genuinely different idea ---------------------------------
const n3 = await note("TEST Lecture 3");
await consolidate(n3, [{
  title: "Cellular respiration",
  summary: "Cells release energy from glucose.",
  body: "Cellular respiration breaks down glucose in the mitochondria to release ATP, consuming oxygen and producing carbon dioxide and water.",
  kind: "definition",
}]);
check("a different concept DOES create a new node", (await db.concept.count()) === before + 2, `total ${await db.concept.count()} (expected ${before + 2})`);

// ---- 3. Dedup threshold behaviour ------------------------------------------
const a = hashEmbed(original.body);
const b = hashEmbed(restated.body);
const c = hashEmbed("Cellular respiration breaks down glucose in the mitochondria to release ATP.");
const cos = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * y[i], 0);
check("near-identical text is above dedup threshold", cos(a, b) > 0.88, cos(a, b).toFixed(3));
check("different concept is below dedup threshold", cos(a, c) < 0.88, cos(a, c).toFixed(3));

// ---- 4. Retrieval expands through the graph --------------------------------
const q = await embedOne("what is an eigenvalue");
const hits = await retrieve(q, 6);
check("retrieve returns results", hits.length > 0, `${hits.length} hits`);
check("top hit is relevant to the query", /eigen/i.test(hits[0]?.title ?? ""), hits[0]?.title);
check("graph walk pulled in neighbours", hits.some((h) => h.viaGraph), hits.filter((h) => h.viaGraph).map((h) => h.title).join(", ") || "none");
check("results are sorted by score", hits.every((h, i) => i === 0 || hits[i - 1].score >= h.score));

// ---- 5. Prerequisite / solid ground ----------------------------------------
// Eigenvalue/eigenvector are well-drilled, so Diagonalization has no WEAK prereq.
const diag = await db.concept.findFirst({ where: { title: "Diagonalization" } });
check("well-mastered prerequisites are not flagged weak", (await weakPrerequisitesFor([diag!.id])).length === 0);

// The criterion depends on Jordan normal form, which is a ghost (never defined).
const crit = await db.concept.findFirst({ where: { title: "Diagonalizability criterion" } });
const weak = await weakPrerequisitesFor([crit!.id]);
check("missing foundation surfaced via graph walk", weak.includes("Jordan normal form"), weak.join(", ") || "none");

const solid = await solidGround();
check("solid ground found for analogies", solid.length > 0, solid.join(", "));
check("solid ground excludes unmastered concepts", !solid.includes("Spectral theorem"));

// ---- 6. Contradiction survives in the graph --------------------------------
const contradictions = await db.edge.count({ where: { relation: "contradicts", resolved: false } });
check("contradiction edge present", contradictions >= 1, `${contradictions}`);

// ---- cleanup ---------------------------------------------------------------
await db.note.deleteMany({ where: { title: { startsWith: "TEST " } } });
await db.concept.deleteMany({ where: { title: { in: ["Photosynthesis", "Cellular respiration"] } } });
const after = await db.concept.count();
check("fixture graph restored after test", after === before, `${after} vs ${before}`);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
