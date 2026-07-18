import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { getAllowedFileRoots, isFilePathAllowed } from "@/lib/file-access";
import { listGitChanges } from "@/lib/git-changes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const cwd = new URL(req.url).searchParams.get("cwd")?.trim();
    if (!cwd) return NextResponse.json({ error: "cwd is required" }, { status: 400 });

    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    if (!existsSync(cwd)) {
      return NextResponse.json({ error: `Directory does not exist: ${cwd}` }, { status: 400 });
    }

    return NextResponse.json(await listGitChanges(cwd));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
