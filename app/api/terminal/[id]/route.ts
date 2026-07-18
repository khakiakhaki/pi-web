import { NextRequest, NextResponse } from "next/server";
import { getTerminalSession, killTerminalSession, resizeTerminal, writeTerminalInput } from "@/lib/terminal-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getTerminalSession(id);
  if (!session) return NextResponse.json({ error: "Terminal not found" }, { status: 404 });
  return NextResponse.json(session);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  if (body.type === "input") {
    if (!writeTerminalInput(id, body.data)) return NextResponse.json({ error: "Terminal not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  }
  if (body.type === "resize") {
    if (!resizeTerminal(id, body.cols, body.rows, body.seq)) return NextResponse.json({ error: "Terminal not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  }
  if (body.type === "kill") {
    killTerminalSession(id);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown terminal command" }, { status: 400 });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  killTerminalSession(id);
  return NextResponse.json({ ok: true });
}
