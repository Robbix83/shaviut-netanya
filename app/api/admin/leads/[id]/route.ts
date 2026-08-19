import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getStore } from "@/lib/store";
import type { LeadStatus, TabuStatus } from "@/lib/types";

export const runtime = "nodejs";

const VALID_STATUSES: LeadStatus[] = ["new", "contacted", "in_progress", "closed", "not_relevant"];
const VALID_TABU: TabuStatus[] = ["pending", "ordered", "clean", "needs_review"];

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json();

  if ("status" in body) {
    if (!VALID_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: "invalid_status" }, { status: 422 });
    }
    await getStore().updateLeadStatus(id, body.status as LeadStatus);
  }

  if ("tabuStatus" in body) {
    if (!VALID_TABU.includes(body.tabuStatus)) {
      return NextResponse.json({ error: "invalid_tabu_status" }, { status: 422 });
    }
    await getStore().updateTabuStatus(id, body.tabuStatus as TabuStatus, body.tabuNotes ?? undefined);
  }

  return NextResponse.json({ ok: true });
}
