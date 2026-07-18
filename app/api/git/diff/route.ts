import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { getAllowedFileRoots, isFilePathAllowed } from "@/lib/file-access";
import { loadGitFileDiff } from "@/lib/git-changes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const cwd = params.get("cwd")?.trim();
    const filePath = params.get("path");
    if (!cwd) return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    if (!filePath) return NextResponse.json({ error: "path is required" }, { status: 400 });

    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    if (!existsSync(cwd)) {
      return NextResponse.json({ error: `Directory does not exist: ${cwd}` }, { status: 400 });
    }

    const result = await loadGitFileDiff(cwd, filePath);
    if (!result) {
      return NextResponse.json({ error: "File no longer has text changes" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
