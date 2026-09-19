// Run this FIRST when the API key arrives. It exercises all four Gemini call
// shapes the app depends on, so a wrong field name surfaces here rather than
// in five routes at once.
//
//   npx tsx scripts/smoke.mts
import "../lib/load-env";
import { embedBatch, generateJSON, generateText, hasApiKey, research } from "../lib/gemini";

if (!hasApiKey()) {
  console.error("GEMINI_API_KEY is not set. Put it in my-app/.env.local and retry.");
  process.exit(1);
}

let failures = 0;
async function step(name: string, fn: () => Promise<string>) {
  try {
    console.log(`\n--- ${name} ---`);
    console.log(await fn());
    console.log(`PASS  ${name}`);
  } catch (e) {
    failures++;
    console.error(`FAIL  ${name}:`, e instanceof Error ? e.message : e);
  }
}

await step("plain text", async () => {
  const t = await generateText({ type: "text", text: "Reply with exactly: ok" });
  if (!t.trim()) throw new Error("empty output_text -- check the field name (output_text vs outputText)");
  return `output_text = ${JSON.stringify(t.slice(0, 80))}`;
});

await step("structured JSON", async () => {
  const r = await generateJSON<{ capital: string; population: number }>(
    { type: "text", text: "Give the capital of France and its approximate population." },
    {
      type: "object",
      properties: { capital: { type: "string" }, population: { type: "number" } },
      required: ["capital", "population"],
    },
    { capital: "", population: 0 },
  );
  if (!r.capital) throw new Error("schema did not bind -- check response_format shape");
  return `parsed = ${JSON.stringify(r)}`;
});

await step("batch embeddings", async () => {
  const vs = await embedBatch(["eigenvalues of a matrix", "convergence of a series"]);
  if (vs.length !== 2) throw new Error(`expected 2 vectors, got ${vs.length}`);
  if (vs[0]?.length !== 768) throw new Error(`expected 768 dims, got ${vs[0]?.length}`);
  const dot = vs[0].reduce((s, x, i) => s + x * vs[1][i], 0);
  return `2 vectors of ${vs[0].length} dims, cross-topic cosine = ${dot.toFixed(3)}`;
});

await step("google search grounding", async () => {
  const r = await research({
    title: "Speed of light",
    body: "The speed of light in vacuum is about 300,000 km per hour.", // deliberately wrong
  });
  if (r.sources.length === 0) throw new Error("no citations -- check steps[].content[].annotations parsing");
  return [
    `corrections: ${r.corrections.length}`,
    r.corrections[0] ? `  "${r.corrections[0].claim}" -> "${r.corrections[0].correction}"` : "",
    `sources: ${r.sources.map((s) => s.url).slice(0, 3).join(", ")}`,
  ].filter(Boolean).join("\n");
});

console.log(failures === 0 ? "\nAll Gemini call shapes verified." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
