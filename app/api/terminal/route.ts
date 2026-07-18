import { NextRequest, NextResponse } from "next/server";
import { createTerminalSession } from "@/lib/terminal-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const session = await createTerminalSession({ cwd: body.cwd, cols: body.cols, rows: body.rows });
    return NextResponse.json(session);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to create terminal" }, { status: 500 });
  }
}
