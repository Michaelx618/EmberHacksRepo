import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { extractFromFile, hasApiKey } from "@/lib/gemini";
import { consolidate } from "@/lib/memory";

export const dynamic = "force-dynamic";

const MAX_BYTES = 15 * 1024 * 1024;

export async function GET() {
  return NextResponse.json(
    await db.note.findMany({
      select: { id: true, title: true, sourceType: true, fileName: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
  );
}

export async function POST(request: Request) {
  if (!hasApiKey()) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY is not set. Add it to my-app/.env.local and restart the dev server." },
      { status: 503 },
    );
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File is ${(file.size / 1e6).toFixed(1)}MB; the inline limit is 15MB.` },
      { status: 413 },
    );
  }

  const mimeType = file.type || "image/png";
  const isPdf = mimeType === "application/pdf";
  if (!isPdf && !mimeType.startsWith("image/")) {
    return NextResponse.json({ error: `Unsupported file type: ${mimeType}` }, { status: 415 });
  }

  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");

  let extracted;
  try {
    extracted = await extractFromFile(base64, mimeType);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? `Extraction failed: ${e.message}` : "Extraction failed" },
      { status: 502 },
    );
  }

  if (extracted.concepts.length === 0) {
    return NextResponse.json(
      { error: "Nothing readable was found in that file." },
      { status: 422 },
    );
  }

  const note = await db.note.create({
    data: {
      title: extracted.title || file.name,
      sourceType: isPdf ? "pdf" : "image",
      fileName: file.name,
      markdown: extracted.markdown,
    },
  });

  const { outcomes, edgesCreated } = await consolidate(
    note.id,
    extracted.concepts.map((c) => ({
      title: c.title,
      summary: c.summary,
      body: c.body,
      kind: c.kind,
      latex: c.latex ?? null,
      tags: c.tags ?? [],
      quote: c.quote ?? null,
    })),
  );

  return NextResponse.json({
    noteId: note.id,
    noteTitle: note.title,
    outcomes,
    edgesCreated,
  });
}
