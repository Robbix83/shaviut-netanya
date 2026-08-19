import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const leads = await getStore().getLeads();
  return NextResponse.json({ leads });
}
