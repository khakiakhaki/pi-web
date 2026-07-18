"use client";

import { useCallback, useEffect, useState } from "react";
import { getFileName } from "@/lib/file-paths";
import type { GitChangedFile, GitChangesResponse, GitChangeStatus } from "@/lib/git-types";

interface Props {
  cwd: string;
  refreshKey: number;
  onRefresh: () => void;
  onOpenDiff: (file: GitChangedFile, cwd: string, repoRoot: string) => void;
}

const STATUS_META: Record<GitChangeStatus, { label: string; color: string; title: string }> = {
  modified: { label: "M", color: "#eab308", title: "Modified" },
  added: { label: "A", color: "#22c55e", title: "Added" },
  deleted: { label: "D", color: "#ef4444", title: "Deleted" },
  renamed: { label: "R", color: "#38bdf8", title: "Renamed" },
  copied: { label: "C", color: "#38bdf8", title: "Copied" },
  untracked: { label: "U", color: "#22c55e", title: "Untracked" },
  conflicted: { label: "!", color: "#f97316", title: "Conflicted" },
  typeChanged: { label: "T", color: "#a78bfa", title: "Type changed" },
};

function directoryOf(relativePath: string): string {
  const slash = relativePath.lastIndexOf("/");
  return slash < 0 ? "" : relativePath.slice(0, slash + 1);
}

export function ChangesSection({ cwd, refreshKey, onRefresh, onOpenDiff }: Props) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<GitChangesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/git/changes?cwd=${encodeURIComponent(cwd)}`, {
        cache: "no-store",
        signal,
      });
      const body = await res.json() as GitChangesResponse & { error?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body);
      setError(null);
    } catch (loadError) {
      if (signal.aborted) return;
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    setOpen(false);
    setData(null);
    setError(null);
  }, [cwd]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, refreshKey]);

  if (!data?.isGit && !error) return null;
  const files = data?.files ?? [];

  return (
    <div style={{ borderTop: "1px solid var(--border)", flex: "0 0 auto", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", minHeight: 30 }}>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          style={{
            display: "flex", alignItems: "center", gap: 6, flex: 1,
            minWidth: 0, padding: "6px 10px", background: "none", border: "none",
            color: "var(--text-muted)", cursor: "pointer", fontSize: 11,
            fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", textAlign: "left",
          }}
        >
          <svg
            width="9" height="9" viewBox="0 0 10 10" fill="none"
            stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }}
          >
            <polyline points="3 2 7 5 3 8" />
          </svg>
          <span>Changes</span>
          {!loading && files.length > 0 && (
            <span style={{
              minWidth: 17, height: 17, padding: "0 5px", display: "inline-flex", alignItems: "center", justifyContent: "center",
              borderRadius: 9, background: "var(--bg-hover)", color: "var(--text-dim)", fontSize: 10,
              fontWeight: 500, letterSpacing: 0,
            }}>
              {files.length}
            </span>
          )}
          {data?.branch && (
            <span title={`Branch: ${data.branch}`} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-dim)", fontSize: 10, fontWeight: 400, letterSpacing: 0, textTransform: "none" }}>
              {data.branch}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          title="Refresh changes"
          aria-label="Refresh changes"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 26, height: 26, padding: 0, marginRight: 6, background: "none", border: "none",
            color: "var(--text-dim)", cursor: loading ? "default" : "pointer", borderRadius: 5,
            opacity: loading ? 0.55 : 1,
          }}
          onMouseEnter={(event) => { if (!loading) event.currentTarget.style.background = "var(--bg-hover)"; }}
          onMouseLeave={(event) => { event.currentTarget.style.background = "none"; }}
        >
          <svg
            width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" className={loading ? "changes-refresh-spin" : undefined}
          >
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
        </button>
      </div>

      {open && (
        <div style={{ maxHeight: "34vh", overflowY: "auto", overflowX: "hidden", padding: "0 4px 5px" }}>
          {error ? (
            <div style={{ padding: "8px 7px", color: "#f87171", fontSize: 11, overflowWrap: "anywhere" }}>{error}</div>
          ) : loading && !data ? (
            <div style={{ padding: "8px 7px", color: "var(--text-dim)", fontSize: 11 }}>Loading changes…</div>
          ) : files.length === 0 ? (
            <div style={{ padding: "8px 7px", color: "var(--text-dim)", fontSize: 11 }}>Working tree clean</div>
          ) : files.map((file) => {
            const meta = STATUS_META[file.status];
            const hovered = hoveredPath === file.path;
            return (
              <button
                key={`${file.oldPath ?? ""}:${file.path}`}
                type="button"
                onClick={() => data?.repoRoot && onOpenDiff(file, cwd, data.repoRoot)}
                onMouseEnter={() => setHoveredPath(file.path)}
                onMouseLeave={() => setHoveredPath(null)}
                title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
                style={{
                  width: "100%", height: 25, padding: "0 7px", display: "flex", alignItems: "center", gap: 7,
                  minWidth: 0, background: hovered ? "var(--bg-hover)" : "none", border: "none", borderRadius: 4,
                  color: "var(--text)", cursor: "pointer", textAlign: "left",
                }}
              >
                <span
                  title={`${meta.title}${file.staged && file.unstaged ? " (staged + unstaged)" : file.staged ? " (staged)" : ""}`}
                  aria-label={meta.title}
                  style={{ width: 13, flexShrink: 0, color: meta.color, fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, textAlign: "center" }}
                >
                  {meta.label}
                </span>
                <span style={{ minWidth: 0, flex: 1, display: "flex", alignItems: "baseline", gap: 6, overflow: "hidden" }}>
                  <span style={{ flexShrink: 0, maxWidth: "58%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 }}>
                    {getFileName(file.path)}
                  </span>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-dim)", fontSize: 10.5 }}>
                    {directoryOf(file.path)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
