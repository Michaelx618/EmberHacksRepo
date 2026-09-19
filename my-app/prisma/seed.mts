// Fixture graph. Every visual state the renderer can draw is represented here,
// so Phase 3 never debugs rendering and data at the same time.
import { db } from "../lib/db";
import "../lib/load-env";
import { embedBatch } from "../lib/gemini";
import { conceptEmbedText } from "../lib/memory";

// Seeded concepts MUST be embedded by whatever embedder live queries will
// use. Mixing the offline stub with real Gemini vectors puts them in
// different spaces, and retrieval silently returns nothing -- the tutor then
// insists your notes don't cover topics that are sitting right there.

const DAY = 24 * 60 * 60 * 1000;
const ago = (d: number) => new Date(Date.now() - d * DAY);

type C = {
  key: string;
  topic: string;
  title: string;
  summary: string;
  body: string;
  kind: string;
  latex?: string;
  tags: string[];
  mastery: number;
  reviewCount?: number;
  lastReviewedAt?: Date;
  status?: string;
  notes: string[]; // note keys that evidence it
};

const CONCEPTS: C[] = [
  // ---- Note A: eigenvalues -------------------------------------------------
  { key: "eigenvalue", topic: "linalg", title: "Eigenvalue", kind: "definition",
    summary: "A scalar λ where Av = λv for some nonzero v.",
    body: "For a square matrix A, a scalar λ is an eigenvalue if there exists a nonzero vector v with Av = λv. Geometrically: A acts on v purely by scaling, without rotating it. The nonzero requirement matters — v = 0 satisfies the equation for every λ and tells you nothing.",
    latex: "A\\mathbf{v} = \\lambda\\mathbf{v}", tags: ["linear algebra", "spectral"],
    mastery: 0.82, reviewCount: 3, lastReviewedAt: ago(2), notes: ["a", "b", "review"] },

  { key: "eigenvector", topic: "linalg", title: "Eigenvector", kind: "definition",
    summary: "A nonzero vector that A only scales.",
    body: "A nonzero vector v satisfying Av = λv. Eigenvectors are not unique: any nonzero multiple of an eigenvector is also an eigenvector for the same λ, so what you really get is an eigenspace.",
    tags: ["linear algebra"], mastery: 0.7, reviewCount: 2, lastReviewedAt: ago(3), notes: ["a"] },

  { key: "charpoly", topic: "linalg", title: "Characteristic polynomial", kind: "formula",
    summary: "det(A − λI) = 0; its roots are the eigenvalues.",
    body: "The polynomial p(λ) = det(A − λI). Its roots are exactly the eigenvalues of A. For an n×n matrix it has degree n, so counting multiplicity there are always n complex eigenvalues.",
    latex: "\\det(A - \\lambda I) = 0", tags: ["linear algebra"],
    mastery: 0.55, reviewCount: 1, lastReviewedAt: ago(6), notes: ["a"] },

  { key: "determinant", topic: "linalg", title: "Determinant", kind: "definition",
    summary: "Scalar measuring how a matrix scales volume.",
    body: "A scalar assigned to a square matrix, measuring the signed volume scaling of the linear map. det(A) = 0 exactly when A is singular — which is why det(A − λI) = 0 detects eigenvalues.",
    tags: ["linear algebra"], mastery: 0.9, reviewCount: 4, lastReviewedAt: ago(1), notes: ["a"] },

  { key: "trace", topic: "linalg", title: "Trace", kind: "definition",
    summary: "Sum of the diagonal; equals the sum of eigenvalues.",
    body: "The sum of the diagonal entries. Useful shortcut: tr(A) equals the sum of the eigenvalues, and det(A) equals their product. Good for sanity-checking a 2×2 by hand.",
    latex: "\\operatorname{tr}(A) = \\sum_i \\lambda_i", tags: ["linear algebra"],
    mastery: 0.35, reviewCount: 1, lastReviewedAt: ago(12), notes: ["a"] },

  { key: "identity-eigen", topic: "linalg", title: "Eigenvalues of the identity", kind: "example",
    summary: "I has λ = 1, and every vector is an eigenvector.",
    body: "For I, Iv = v = 1·v for every v. So λ = 1 is the only eigenvalue, with the whole space as its eigenspace. The cleanest case where eigenvectors are wildly non-unique.",
    tags: ["linear algebra", "example"], mastery: 0.75, reviewCount: 2, lastReviewedAt: ago(4), notes: ["a"] },

  { key: "find-eigen", topic: "linalg", title: "Finding eigenvalues by hand", kind: "process",
    summary: "Form A − λI, take its determinant, solve for λ.",
    body: "1. Write A − λI. 2. Take the determinant to get the characteristic polynomial. 3. Set it to zero and solve for λ. 4. For each λ, solve (A − λI)v = 0 to get the eigenspace.",
    tags: ["linear algebra", "method"], mastery: 0.48, reviewCount: 1, lastReviewedAt: ago(8), notes: ["a"] },

  { key: "alg-mult", topic: "linalg", title: "Algebraic multiplicity", kind: "definition",
    summary: "How many times λ repeats as a root of the char. polynomial.",
    body: "The multiplicity of λ as a root of the characteristic polynomial. Always at least the geometric multiplicity, and the gap between the two is exactly what obstructs diagonalization.",
    tags: ["linear algebra"], mastery: 0.25, reviewCount: 0, notes: ["a"] },

  // the WRONG one -- contradicts the Lecture 4 theorem
  { key: "diag-wrong", topic: "linalg", title: "Diagonalizable ⟺ n distinct eigenvalues", kind: "fact",
    summary: "Claim from Lecture 3 notes: distinct eigenvalues is the criterion.",
    body: "An n×n matrix is diagonalizable if and only if it has n distinct eigenvalues.",
    tags: ["linear algebra"], mastery: 0.4, reviewCount: 1, lastReviewedAt: ago(9), notes: ["a"] },

  { key: "matmul", topic: "linalg", title: "Matrix multiplication", kind: "definition",
    summary: "Composition of linear maps; row-by-column.",
    body: "(AB)ᵢⱼ is the dot product of row i of A with column j of B. Conceptually it is composition of linear maps, which is why it is associative but not commutative.",
    tags: ["linear algebra", "foundations"], mastery: 0.95, reviewCount: 6, lastReviewedAt: ago(1), notes: ["a"] },

  // ---- Note B: diagonalization --------------------------------------------
  { key: "diagonalization", topic: "linalg", title: "Diagonalization", kind: "definition",
    summary: "Writing A = PDP⁻¹ with D diagonal.",
    body: "Factoring A = PDP⁻¹ where D is diagonal and P's columns are eigenvectors of A. This is a change of basis into coordinates where A acts by independent scaling along each axis.",
    latex: "A = PDP^{-1}", tags: ["linear algebra"], mastery: 0.5, reviewCount: 1, lastReviewedAt: ago(5), notes: ["b"] },

  // the RIGHT one
  { key: "diag-right", topic: "linalg", title: "Diagonalizability criterion", kind: "theorem",
    summary: "Diagonalizable ⟺ eigenvectors span the space.",
    body: "An n×n matrix is diagonalizable if and only if it has n linearly independent eigenvectors — equivalently, geometric multiplicity equals algebraic multiplicity for every eigenvalue. Having n distinct eigenvalues is SUFFICIENT but not NECESSARY: the identity has a single repeated eigenvalue and is already diagonal.",
    tags: ["linear algebra", "theorem"], mastery: 0.3, reviewCount: 0, notes: ["b"] },

  { key: "geo-mult", topic: "linalg", title: "Geometric multiplicity", kind: "definition",
    summary: "Dimension of the eigenspace for λ.",
    body: "dim(null(A − λI)) — how many independent eigenvectors λ actually has. Diagonalizability is precisely the condition that this matches algebraic multiplicity everywhere.",
    tags: ["linear algebra"], mastery: 0.2, reviewCount: 0, notes: ["b"] },

  { key: "similar", topic: "linalg", title: "Similar matrices", kind: "definition",
    summary: "B = P⁻¹AP — same map, different basis.",
    body: "A and B are similar if B = P⁻¹AP for invertible P. Similar matrices share eigenvalues, determinant, trace and characteristic polynomial — they are the same linear map seen in different coordinates.",
    tags: ["linear algebra"], mastery: 0.15, reviewCount: 0, notes: ["b"] },

  { key: "spectral", topic: "linalg", title: "Spectral theorem", kind: "theorem",
    summary: "Real symmetric matrices are orthogonally diagonalizable.",
    body: "Every real symmetric matrix has real eigenvalues and an orthonormal basis of eigenvectors, so A = QDQᵀ with Q orthogonal. This is why symmetric matrices are so much better behaved.",
    latex: "A = QDQ^{T}", tags: ["linear algebra", "theorem"], mastery: 0.1, reviewCount: 0, notes: ["b"] },

  { key: "diag-2x2", topic: "linalg", title: "Diagonalizing a 2×2", kind: "example",
    summary: "Worked example on [[2,1],[1,2]].",
    body: "For A = [[2,1],[1,2]]: char. poly (2−λ)² − 1 = 0 gives λ = 1, 3. Eigenvectors (1,−1) and (1,1). So P = [[1,1],[−1,1]], D = diag(1,3).",
    tags: ["linear algebra", "example"], mastery: 0.6, reviewCount: 2, lastReviewedAt: ago(4), notes: ["b"] },

  { key: "matrix-power", topic: "linalg", title: "Powers of a diagonalized matrix", kind: "formula",
    summary: "Aⁿ = PDⁿP⁻¹ — the payoff of diagonalizing.",
    body: "Once A = PDP⁻¹, Aⁿ = PDⁿP⁻¹, and Dⁿ is just each diagonal entry raised to n. Turns an O(n) chain of matrix multiplications into scalar exponentiation.",
    latex: "A^{n} = PD^{n}P^{-1}", tags: ["linear algebra"], mastery: 0.45, reviewCount: 1, lastReviewedAt: ago(7), notes: ["b"] },

  // GHOST: referenced as a prerequisite, never actually defined in any note
  { key: "jordan", topic: "linalg", title: "Jordan normal form", kind: "definition",
    summary: "Referenced in your notes but never defined.",
    body: "", status: "ghost", tags: ["linear algebra"], mastery: 0, notes: [] },

  // ---- Note C: series ------------------------------------------------------
  { key: "convergent", topic: "calculus", title: "Convergent series", kind: "definition",
    summary: "Partial sums approach a finite limit.",
    body: "A series Σaₙ converges if its sequence of partial sums Sₙ = a₁ + … + aₙ has a finite limit. Otherwise it diverges. Note this is about the PARTIAL SUMS, not the terms.",
    tags: ["calculus", "series"], mastery: 0.65, reviewCount: 2, lastReviewedAt: ago(3), notes: ["c", "review"] },

  { key: "ratio-test", topic: "calculus", title: "Ratio test", kind: "process",
    summary: "L = lim|aₙ₊₁/aₙ|; converges if L < 1.",
    body: "Compute L = lim |aₙ₊₁/aₙ|. If L < 1 the series converges absolutely; if L > 1 it diverges; if L = 1 the test is inconclusive and you need another one.",
    latex: "L = \\lim_{n\\to\\infty}\\left|\\frac{a_{n+1}}{a_n}\\right|",
    tags: ["calculus", "series", "method"], mastery: 0.55, reviewCount: 2, lastReviewedAt: ago(5), notes: ["c"] },

  { key: "geometric", topic: "calculus", title: "Geometric series", kind: "formula",
    summary: "Σrⁿ = 1/(1−r) when |r| < 1.",
    body: "For |r| < 1, Σ_{n=0}^∞ rⁿ = 1/(1 − r). Diverges for |r| ≥ 1. The one series where you get the exact sum, not just convergence.",
    latex: "\\sum_{n=0}^{\\infty} r^{n} = \\frac{1}{1-r}, \\quad |r|<1",
    tags: ["calculus", "series"], mastery: 0.8, reviewCount: 3, lastReviewedAt: ago(2), notes: ["c"] },

  { key: "p-series", topic: "calculus", title: "p-series test", kind: "fact",
    summary: "Σ1/nᵖ converges iff p > 1.",
    body: "Σ 1/nᵖ converges if and only if p > 1. The boundary case p = 1 is the harmonic series, which diverges — slowly, but it does.",
    latex: "\\sum \\frac{1}{n^{p}}", tags: ["calculus", "series"],
    mastery: 0.5, reviewCount: 1, lastReviewedAt: ago(6), notes: ["c"] },

  { key: "harmonic", topic: "calculus", title: "The harmonic series diverges", kind: "example",
    summary: "Σ1/n diverges despite terms → 0.",
    body: "Σ 1/n diverges even though 1/n → 0. Grouping terms 1/3+1/4 > 1/2, 1/5+…+1/8 > 1/2, … adds 1/2 infinitely often. The standard counterexample to 'terms go to zero so it converges'.",
    tags: ["calculus", "series", "counterexample"], mastery: 0.7, reviewCount: 2, lastReviewedAt: ago(4), notes: ["c"] },

  { key: "limit-comparison", topic: "calculus", title: "Limit comparison test", kind: "process",
    summary: "If lim aₙ/bₙ is finite and positive, both do the same thing.",
    body: "If aₙ, bₙ > 0 and lim aₙ/bₙ = c with 0 < c < ∞, then Σaₙ and Σbₙ both converge or both diverge. Usually you compare against a p-series.",
    tags: ["calculus", "series", "method"], mastery: 0.3, reviewCount: 0, notes: ["c"] },

  { key: "abs-convergence", topic: "calculus", title: "Absolute convergence", kind: "definition",
    summary: "Σ|aₙ| converges ⟹ Σaₙ converges.",
    body: "Σaₙ converges absolutely if Σ|aₙ| converges. Absolute convergence implies convergence, and lets you rearrange terms freely — conditionally convergent series do not allow that.",
    tags: ["calculus", "series"], mastery: 0.2, reviewCount: 0, notes: ["c"] },
];

const NOTES = [
  { key: "a", title: "Linear Algebra — Lecture 3: Eigenvalues", sourceType: "image", fileName: "IMG_3104.HEIC", days: 14 },
  { key: "b", title: "Linear Algebra — Lecture 4: Diagonalization", sourceType: "pdf", fileName: "lecture4.pdf", days: 7 },
  { key: "c", title: "Calc II — Series Convergence", sourceType: "image", fileName: "IMG_3119.HEIC", days: 5 },
  { key: "review", title: "Review sheet — Midterm 1", sourceType: "pdf", fileName: "midterm1-review.pdf", days: 1 },
];

// Every relation type is represented.
const EDGES: [string, string, string, number, string][] = [
  ["matmul", "eigenvalue", "prerequisite", 0.9, "Av = λv is a matrix product; you need that first."],
  ["determinant", "charpoly", "prerequisite", 0.95, "The characteristic polynomial is a determinant."],
  ["eigenvalue", "diagonalization", "prerequisite", 0.9, "Diagonalization is built out of eigenvalues."],
  ["eigenvector", "diagonalization", "prerequisite", 0.85, "P's columns are eigenvectors."],
  ["jordan", "diag-right", "prerequisite", 0.6, "The non-diagonalizable case is handled by Jordan form."],
  ["charpoly", "find-eigen", "prerequisite", 0.8, "The method is solving the characteristic polynomial."],
  ["convergent", "ratio-test", "prerequisite", 0.8, "The test decides convergence."],
  ["p-series", "limit-comparison", "prerequisite", 0.7, "p-series are the usual comparison target."],

  ["alg-mult", "eigenvalue", "elaborates", 0.8, "Refines what a repeated eigenvalue means."],
  ["geo-mult", "eigenvector", "elaborates", 0.8, "Counts independent eigenvectors per λ."],
  ["trace", "eigenvalue", "elaborates", 0.65, "Trace equals the sum of eigenvalues."],
  ["similar", "diagonalization", "elaborates", 0.75, "Diagonalization is similarity to a diagonal matrix."],
  ["abs-convergence", "convergent", "elaborates", 0.7, "A strictly stronger form of convergence."],

  ["identity-eigen", "eigenvalue", "example_of", 0.9, "Simplest possible eigenvalue computation."],
  ["diag-2x2", "diagonalization", "example_of", 0.9, "Worked instance of the general procedure."],
  ["harmonic", "p-series", "example_of", 0.9, "The p = 1 boundary case."],
  ["geometric", "convergent", "example_of", 0.7, "A series with a closed-form sum."],

  ["diag-wrong", "diagonalization", "related", 0.8, "States a criterion for when diagonalization is possible."],
  ["diag-right", "diagonalization", "elaborates", 0.85, "Gives the precise condition for diagonalizability."],
  ["geo-mult", "diag-right", "prerequisite", 0.8, "The criterion is stated in terms of geometric multiplicity."],
  ["alg-mult", "diag-right", "prerequisite", 0.75, "Compared against geometric multiplicity."],

  // the money shot
  ["diag-wrong", "diag-right", "contradicts", 0.95,
   "Lecture 3 states distinct eigenvalues is necessary and sufficient; Lecture 4's theorem says it is only sufficient."],

  ["spectral", "diagonalization", "related", 0.7, "A special case with stronger guarantees."],
  ["matrix-power", "diagonalization", "related", 0.8, "The main practical payoff of diagonalizing."],
  ["ratio-test", "geometric", "related", 0.6, "The ratio test is exact on geometric series."],
  ["limit-comparison", "ratio-test", "related", 0.6, "Alternative convergence tests."],
  ["find-eigen", "diag-2x2", "related", 0.65, "The example applies this procedure."],
];

async function main() {
  console.log("Resetting fixture data...");
  await db.edge.deleteMany();
  await db.conceptRevision.deleteMany();
  await db.conceptSource.deleteMany();
  await db.concept.deleteMany();
  await db.note.deleteMany();

  const noteIds = new Map<string, string>();
  for (const n of NOTES) {
    const created = await db.note.create({
      data: {
        title: n.title,
        sourceType: n.sourceType,
        fileName: n.fileName,
        markdown: `# ${n.title}\n\n(transcription fixture)`,
        createdAt: ago(n.days),
      },
    });
    noteIds.set(n.key, created.id);
  }

  // One batched call for every concept, using the live embedder when a key
  // is configured and the deterministic stub otherwise.
  const { hasApiKey } = await import("../lib/gemini");
  console.log(`Embedding ${CONCEPTS.length} concepts (live embedder: ${hasApiKey()})...`);
  const vectors = await embedBatch(CONCEPTS.map(conceptEmbedText));
  if (vectors.length !== CONCEPTS.length) {
    throw new Error(`embedding count mismatch: ${vectors.length} vs ${CONCEPTS.length}`);
  }

  const conceptIds = new Map<string, string>();
  for (let ci = 0; ci < CONCEPTS.length; ci++) {
    const c = CONCEPTS[ci];
    const created = await db.concept.create({
      data: {
        title: c.title,
        summary: c.summary,
        body: c.body,
        kind: c.kind,
        latex: c.latex ?? null,
        tags: JSON.stringify(c.tags),
        embedding: JSON.stringify(vectors[ci]),
        mastery: c.mastery,
        encounterCount: Math.max(1, c.notes.length),
        reviewCount: c.reviewCount ?? 0,
        lastReviewedAt: c.lastReviewedAt ?? null,
        status: c.status ?? "active",
      },
    });
    conceptIds.set(c.key, created.id);

    for (const noteKey of c.notes) {
      await db.conceptSource.create({
        data: {
          conceptId: created.id,
          noteId: noteIds.get(noteKey)!,
          quote: `…${c.summary}…`,
        },
      });
    }
  }

  for (const [from, to, relation, strength, rationale] of EDGES) {
    await db.edge.create({
      data: { sourceId: conceptIds.get(from)!, targetId: conceptIds.get(to)!, relation, strength, rationale },
    });
  }

  // One revision, so the inspector's lineage view has something to show.
  await db.conceptRevision.create({
    data: {
      conceptId: conceptIds.get("eigenvalue")!,
      body: "A number λ where multiplying by A just stretches the vector.",
      reason: "superseded by Review sheet — Midterm 1 (added the nonzero-vector condition)",
      createdAt: ago(1),
    },
  });

  await db.learnerProfile.upsert({ where: { id: "me" }, create: {}, update: { style: "{}", confusion: "[]", turnCount: 0 } });

  const kinds = await db.concept.groupBy({ by: ["kind"], _count: true });
  const rels = await db.edge.groupBy({ by: ["relation"], _count: true });
  console.log(`\n${NOTES.length} notes, ${CONCEPTS.length} concepts, ${EDGES.length} edges`);
  console.log("kinds:    ", kinds.map((k) => `${k.kind}=${k._count}`).join(" "));
  console.log("relations:", rels.map((r) => `${r.relation}=${r._count}`).join(" "));
  const multi = await db.concept.findMany({ where: { encounterCount: { gte: 2 } }, select: { title: true, encounterCount: true } });
  console.log("multi-source:", multi.map((m) => `${m.title}(${m.encounterCount})`).join(", "));
  console.log("ghost:", (await db.concept.findMany({ where: { status: "ghost" }, select: { title: true } })).map((g) => g.title).join(", "));
}

await main();
