import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { degradedReason, hasApiKey } from "@/lib/gemini";

export const dynamic = "force-dynamic";

/**
 * POST /api/live — open a live capture session.
 *
 * The note is created before the first frame on purpose: the student sees it
 * appear in the sidebar the moment the camera turns on, so what they write is
 * visibly going somewhere. Frames then accumulate into this one note rather
 * than each becoming a note of its own.
 */
export async function POST(request: Request) {
  // Same hard failure as the uploader -- reading handwriting has no offline
  // stand-in, and a session that can never capture anything is worse than a
  // refusal up front.
  if (!hasApiKey()) {
    return NextResponse.json(
      {
        error:
          degradedReason() ??
          "GEMINI_API_KEY is not set. Add it to my-app/.env.local and restart the dev server.",
      },
      { status: 503 },
    );
  }

  const { title } = ((await request.json().catch(() => ({}))) ?? {}) as { title?: string };

  const note = await db.note.create({
    data: {
      title: title?.trim() || `Live capture — ${timestamp()}`,
      sourceType: "live",
      markdown: "",
    },
    select: { id: true, title: true, sourceType: true, createdAt: true },
  });

  return NextResponse.json(note);
}

function timestamp(): string {
  return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
