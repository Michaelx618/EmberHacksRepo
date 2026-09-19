import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { degradedReason, extractLiveFrame, hasApiKey, noteIfUnavailable } from "@/lib/gemini";
import { consolidate } from "@/lib/memory";
import { mergeTranscript } from "@/lib/transcript";

export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024;

/** Titles we hand the model as "already captured". Enough to suppress repeats
 *  without spending the whole prompt on a page that has been running a while. */
const KNOWN_LIMIT = 60;

/**
 * POST /api/live/frame — fold one camera frame into an open live note.
 *
 * Expects multipart with `frame` (an image blob) and `noteId`. The client only
 * sends a frame once the picture has stopped moving and differs from the last
 * one it sent, so most frames the camera produces never reach here.
 */
export async function POST(request: Request) {
  if (!hasApiKey()) {
    return NextResponse.json(
      { error: degradedReason() ?? "GEMINI_API_KEY is not set." },
      { status: 503 },
    );
  }

  const form = await request.formData();
  const noteId = form.get("noteId");
  const frame = form.get("frame");
  // "Capture now" -- the student is asking for this page to be read in full,
  // so we don't tell the model what we already have. Consolidation still
  // reinforces rather than duplicates anything that comes back twice.
  const force = form.get("force") === "1";

  if (typeof noteId !== "string" || !noteId) {
    return NextResponse.json({ error: "Missing noteId." }, { status: 400 });
  }
  if (!(frame instanceof File)) {
    return NextResponse.json({ error: "No frame uploaded." }, { status: 400 });
  }
  if (frame.size > MAX_BYTES) {
    return NextResponse.json({ error: "Frame too large." }, { status: 413 });
  }

  const note = await db.note.findUnique({
    where: { id: noteId },
    select: { id: true, title: true, markdown: true },
  });
  if (!note) {
    // The student deleted the note mid-session. Say so specifically so the
    // client can close the session instead of retrying every frame forever.
    return NextResponse.json({ error: "This live note no longer exists.", gone: true }, { status: 410 });
  }

  const known = force
    ? []
    : await db.conceptSource.findMany({
        where: { noteId },
        select: { concept: { select: { title: true } } },
        take: KNOWN_LIMIT,
        orderBy: { concept: { createdAt: "desc" } },
      });

  const base64 = Buffer.from(await frame.arrayBuffer()).toString("base64");

  let extracted;
  try {
    extracted = await extractLiveFrame(
      base64,
      known.map((k) => k.concept.title),
      frame.type || "image/jpeg",
    );
  } catch (e) {
    noteIfUnavailable(e);
    const reason = degradedReason();
    return NextResponse.json(
      { error: reason ?? (e instanceof Error ? e.message : "Frame read failed") },
      { status: reason ? 503 : 502 },
    );
  }

  // Nothing on the page that this note doesn't already hold -- the usual answer
  // while the same page sits in front of the camera.
  if (extracted.concepts.length === 0) {
    return NextResponse.json({ noteId, noteTitle: note.title, outcomes: [], edgesCreated: 0 });
  }

  const { outcomes, edgesCreated } = await consolidate(
    noteId,
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

  // Once the page has told us what it is about, use that instead of the clock.
  const rename =
    note.title.startsWith("Live capture —") && extracted.title.trim()
      ? extracted.title.trim()
      : null;

  const markdown = mergeTranscript(note.markdown, extracted.markdown.trim());
  if (rename || markdown !== note.markdown) {
    await db.note.update({
      where: { id: noteId },
      data: { ...(rename ? { title: rename } : {}), markdown },
    });
  }

  return NextResponse.json({
    noteId,
    noteTitle: rename ?? note.title,
    outcomes,
    edgesCreated,
  });
}
