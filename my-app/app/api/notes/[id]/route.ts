import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** PATCH /api/notes/:id — rename a note */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const { title } = (await request.json()) as { title?: string };

  if (!title?.trim()) {
    return NextResponse.json({ error: "Title cannot be empty." }, { status: 400 });
  }

  const note = await db.note.update({
    where: { id },
    data: { title: title.trim() },
    select: { id: true, title: true },
  });

  return NextResponse.json(note);
}

/** DELETE /api/notes/:id — delete a note and orphaned concepts */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;

  // Cascade deletes ConceptSources via schema onDelete: Cascade.
  // After removing sources, concepts with no remaining sources become orphans —
  // remove those too so the graph stays clean.
  await db.note.delete({ where: { id } });

  // Clean up concepts that no longer have any source note
  await db.concept.deleteMany({
    where: { sources: { none: {} } },
  });

  return NextResponse.json({ ok: true });
}
