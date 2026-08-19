/** GET /api/streets-raw → הרשימה הרשמית המלאה (לשימוש הקוצר בדפדפן) */
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

export async function GET() {
  try {
    const raw = await fs.readFile(path.join(process.cwd(), "data", "netanya-streets-raw.json"), "utf8");
    return NextResponse.json({ streets: JSON.parse(raw) });
  } catch {
    return NextResponse.json({ streets: [] });
  }
}
