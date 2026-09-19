import { NextResponse } from "next/server";
import { acceptProposeLink } from "@/lib/tutor-actions";

export const dynamic = "force-dynamic";

/** Accept a tutor-proposed graph edge (demo click → canvas updates). */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    sourceId?: string;
    targetId?: string;
    relation?: string;
    rationale?: string;
  };

  const result = await acceptProposeLink({
    sourceId: body.sourceId ?? "",
    targetId: body.targetId ?? "",
    relation: body.relation ?? "related",
    rationale: body.rationale ?? "",
  });

  if ("error" in result) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json(result);
}
