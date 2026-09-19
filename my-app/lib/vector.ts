// Vector math for the concept memory. Embeddings live as JSON strings in
// SQLite and cosine runs in-process -- below a few thousand concepts that is
// faster than a round trip to a vector DB, and it has no network dependency.

/** Cosine similarity of two equal-length vectors. Returns 0 on degenerate input. */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export type Scored<T> = { item: T; similarity: number };

/**
 * Top-k most similar candidates above `threshold`, best first.
 * `getVector` lets callers pass rows straight from Prisma.
 */
export function topK<T>(
  query: number[],
  candidates: T[],
  getVector: (item: T) => number[],
  k: number,
  threshold = 0,
): Scored<T>[] {
  const scored: Scored<T>[] = [];

  for (const item of candidates) {
    const similarity = cosine(query, getVector(item));
    if (similarity >= threshold) scored.push({ item, similarity });
  }

  scored.sort((x, y) => y.similarity - x.similarity);
  return scored.slice(0, k);
}

/** Parse an embedding stored as a JSON string. Returns [] if unparseable. */
export function parseEmbedding(json: string | null | undefined): number[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Deterministic pseudo-random unit vector -- used by the seed so the graph
 *  has plausible similarity structure before any API key exists. */
export function fakeUnitVector(seed: string, dim = 768): number[] {
  // xmur3 + sfc32: tiny, seedable, good enough for fixtures.
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  let b = (h ^ 0x9e3779b9) >>> 0;
  let c = (h ^ 0x85ebca6b) >>> 0;
  let d = (h ^ 0xc2b2ae35) >>> 0;

  const next = () => {
    const t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    c = (c + t) | 0;
    return ((t + d) | 0) >>> 0;
  };

  const v: number[] = [];
  for (let i = 0; i < dim; i++) v.push(next() / 4294967296 - 0.5);

  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

/**
 * Offline stand-in for a real embedding model: hashed bag-of-words.
 * Crucially it is SEMANTIC ENOUGH that near-identical text scores near 1,
 * so dedup and consolidation behave realistically before an API key exists.
 */
export function hashEmbed(text: string, dim = 768): number[] {
  const v = new Array(dim).fill(0);
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2)
    // Crude stemming: without it "eigenvalues" and "eigenvalue" are unrelated
    // tokens, and offline retrieval picks visibly wrong concepts.
    .map((t) => t.replace(/(ies)$/, "y").replace(/(sses|shes|ches)$/, "s").replace(/([^s])s$/, "$1"));

  for (const token of tokens) {
    // Three hashes per token spreads mass and reduces collisions.
    for (let salt = 0; salt < 3; salt++) {
      let h = 2166136261 ^ salt;
      for (let i = 0; i < token.length; i++) {
        h = Math.imul(h ^ token.charCodeAt(i), 16777619);
      }
      v[Math.abs(h) % dim] += 1;
    }
  }

  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return norm === 0 ? v : v.map((x) => x / norm);
}
