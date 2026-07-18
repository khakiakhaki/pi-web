"use client";

import { useEffect, useMemo, useState } from "react";
import { Diff, Hunk, markEdits, parseDiff, tokenize, type DiffType, type HunkData } from "react-diff-view";
import { createDisplayPatch, type DiffDisplayScope } from "@/lib/diff-display";
import type { GitFileDiffResponse } from "@/lib/git-types";
import type { DiffTab } from "./TabBar";

interface Props {
  tab: DiffTab;
  isMobile: boolean;
  refreshKey: number;
  viewMode: DiffView;
  scope: DiffDisplayScope;
  wrap: boolean;
  onViewModeChange: (view: DiffView) => void;
  onScopeChange: (scope: DiffDisplayScope) => void;
  onWrapChange: (wrap: boolean) => void;
  onWidthModeChange: (mode: "normal" | "wide") => void;
  onMetadataChange: (metadata: Pick<DiffTab, "path" | "oldPath" | "status" | "repoRoot">) => void;
}

type DiffView = "unified" | "split";

const CHARACTER_HIGHLIGHT_MAX_PATCH_BYTES = 521 * 1024;
const CHARACTER_HIGHLIGHT_MAX_CHANGES = 4_000;
const CHARACTER_HIGHLIGHT_MAX_LINE = 20_000;

function statusToDiffType(status: DiffTab["status"]): DiffType {
  if (status === "added" || status === "untracked") return "add";
  if (status === "deleted") return "delete";
  if (status === "renamed") return "rename";
  if (status === "copied") return "copy";
  return "modify";
}

function canHighlightCharacters(patch: string, hunks: HunkData[]): boolean {
  if (new TextEncoder().encode(patch).length > CHARACTER_HIGHLIGHT_MAX_PATCH_BYTES) return false;
  let changes = 0;
  for (const hunk of hunks) {
    changes += hunk.changes.length;
    if (changes > CHARACTER_HIGHLIGHT_MAX_CHANGES) return false;
    if (hunk.changes.some((change) => change.content.length > CHARACTER_HIGHLIGHT_MAX_LINE)) return false;
  }
  return true;
}

function SegmentedButton({
  active,
  disabled,
  onClick,
  title,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        height: 25, padding: "0 8px", border: "none", borderRadius: 5,
        background: active ? "var(--bg-selected)" : "transparent",
        color: disabled ? "var(--text-dim)" : active ? "var(--text)" : "var(--text-muted)",
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        whiteSpace: "nowrap", fontSize: 10.5,
      }}
    >
      {children}
    </button>
  );
}

function ButtonGroup({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 1, padding: 2, border: "1px solid var(--border)", borderRadius: 7, background: "var(--bg-panel)", flexShrink: 0 }}>
      {children}
    </div>
  );
}

export function DiffViewer({ tab, isMobile, refreshKey, viewMode, scope, wrap, onViewModeChange, onScopeChange, onWrapChange, onWidthModeChange, onMetadataChange }: Props) {
  const [data, setData] = useState<GitFileDiffResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/git/diff?cwd=${encodeURIComponent(tab.cwd)}&path=${encodeURIComponent(tab.path)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json() as GitFileDiffResponse & { error?: string };
        if (!response.ok || body.error) throw new Error(body.error ?? `HTTP ${response.status}`);
        return body;
      })
      .then((body) => {
        if (controller.signal.aborted) return;
        setData(body);
        onMetadataChange({
          path: body.path,
          ...(body.oldPath ? { oldPath: body.oldPath } : {}),
          status: body.status,
          repoRoot: body.repoRoot,
        });
      })
      .catch((loadError) => {
        if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [tab.cwd, tab.path, refreshKey, onMetadataChange]);

  const effectiveView: DiffView = isMobile ? "unified" : viewMode;
  const effectiveScope: DiffDisplayScope = data?.fullViewAvailable === false ? "changes" : scope;

  const patch = useMemo(() => data ? createDisplayPatch(data, effectiveScope) : "", [data, effectiveScope]);

  const parsed = useMemo(() => {
    if (!patch) return null;
    try {
      return parseDiff(patch, { nearbySequences: "zip" })[0] ?? null;
    } catch {
      return null;
    }
  }, [patch]);

  const tokens = useMemo(() => {
    if (!parsed || !canHighlightCharacters(patch, parsed.hunks)) return null;
    try {
      return tokenize(parsed.hunks, { enhancers: [markEdits(parsed.hunks, { type: "line" })] });
    } catch {
      return null;
    }
  }, [parsed, patch]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div className="diff-toolbar" style={{ minHeight: 39, display: "flex", alignItems: "center", gap: 7, padding: "5px 8px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)", overflowX: "auto", flexShrink: 0 }}>
        <span title={data?.oldPath ? `${data.oldPath} → ${data.path}` : data?.path ?? tab.path} style={{ minWidth: 80, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-muted)", fontSize: 10.5, marginRight: "auto" }}>
          {data?.path ?? tab.path}
        </span>

        {!isMobile && (
          <ButtonGroup>
            <SegmentedButton active={effectiveView === "unified"} onClick={() => onViewModeChange("unified")}>Inline</SegmentedButton>
            <SegmentedButton active={effectiveView === "split"} onClick={() => onViewModeChange("split")}>Split</SegmentedButton>
          </ButtonGroup>
        )}

        <ButtonGroup>
          <SegmentedButton active={effectiveScope === "changes"} onClick={() => onScopeChange("changes")}>Changes</SegmentedButton>
          <SegmentedButton
            active={effectiveScope === "full"}
            disabled={!data?.fullViewAvailable}
            onClick={() => onScopeChange("full")}
            title={data?.fullViewAvailable ? "Show the complete file" : data?.limitedReason ?? "Full file exceeds the 521 KiB limit"}
          >
            Full
          </SegmentedButton>
        </ButtonGroup>

        <ButtonGroup>
          <SegmentedButton active={wrap} onClick={() => onWrapChange(!wrap)}>Wrap</SegmentedButton>
        </ButtonGroup>

        {!isMobile && (
          <ButtonGroup>
            <SegmentedButton active={tab.widthMode === "normal"} onClick={() => onWidthModeChange("normal")}>Normal</SegmentedButton>
            <SegmentedButton active={tab.widthMode === "wide"} onClick={() => onWidthModeChange("wide")}>Wide</SegmentedButton>
          </ButtonGroup>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: "var(--bg)" }}>
        {loading ? (
          <div className="diff-view-state">Loading diff…</div>
        ) : error ? (
          <div className="diff-view-state diff-view-error">{error}</div>
        ) : !patch ? (
          <div className="diff-view-state">
            {data?.limitedReason ?? "No text diff available"}
          </div>
        ) : !parsed ? (
          <div className="diff-view-state diff-view-error">Unable to parse this Git diff</div>
        ) : parsed.hunks.length === 0 ? (
          <div className="diff-view-state">Working tree clean</div>
        ) : (
          <div className={`pi-diff-viewer${wrap ? " diff-wrap" : " diff-nowrap"}${effectiveView === "split" ? " diff-is-split" : ""}`}>
            <Diff
              viewType={effectiveView}
              diffType={statusToDiffType(data?.status ?? tab.status)}
              hunks={parsed.hunks}
              tokens={tokens}
              optimizeSelection={effectiveView === "split"}
            >
              {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
            </Diff>
          </div>
        )}
      </div>
    </div>
  );
}
