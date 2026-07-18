"use client";

import { useState } from "react";
import type { GitChangeStatus } from "@/lib/git-types";
import { getFileIcon } from "./FileIcons";

export interface FileTab {
  kind: "file";
  id: string;
  label: string;
  filePath: string;
  sourceSessionId?: string | null;
}

export interface DiffTab {
  kind: "diff";
  id: string;
  label: string;
  cwd: string;
  repoRoot: string;
  path: string;
  oldPath?: string;
  status: GitChangeStatus;
  widthMode: "normal" | "wide";
}

export type Tab = FileTab | DiffTab;

interface Props {
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
}

function diffAccent(status: GitChangeStatus): string {
  if (status === "added" || status === "untracked" || status === "copied") return "#22c55e";
  if (status === "deleted") return "#ef4444";
  if (status === "conflicted") return "#f97316";
  return "linear-gradient(90deg, #ef4444 0 50%, #22c55e 50% 100%)";
}

export function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab }: Props) {
  const [hoveredClose, setHoveredClose] = useState<string | null>(null);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        background: "var(--bg-panel)",
        overflowX: "auto",
        flexShrink: 0,
        height: 36,
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const isDiff = tab.kind === "diff";
        const accent = isDiff ? diffAccent(tab.status) : "transparent";
        const title = isDiff
          ? (tab.oldPath ? `${tab.oldPath} → ${tab.path}` : tab.path)
          : tab.filePath;
        return (
          <div
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              gap: 6,
              height: 36,
              boxSizing: "border-box",
              paddingLeft: 12,
              paddingRight: 6,
              borderRight: "1px solid var(--border)",
              background: isActive ? "var(--bg)" : "var(--bg-panel)",
              cursor: "pointer",
              fontSize: 12,
              color: isActive ? "var(--text)" : "var(--text-muted)",
              whiteSpace: "nowrap",
              maxWidth: 210,
              minWidth: 80,
              flexShrink: 0,
              userSelect: "none",
              transition: "background 0.1s, color 0.1s",
            }}
          >
            {isDiff && (
              <span
                aria-hidden="true"
                style={{
                  position: "absolute", top: 0, left: 0, right: 0, height: 2,
                  background: accent,
                  opacity: isActive ? 1 : 0.62,
                }}
              />
            )}
            <span style={{ flexShrink: 0, opacity: isActive ? 1 : 0.7, display: "flex", alignItems: "center" }}>
              {getFileIcon(isDiff ? tab.path : tab.label, 13)}
            </span>
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                flex: 1,
                fontWeight: isActive ? 500 : 400,
              }}
              title={title}
            >
              {tab.label}
            </span>
            <button
              onClick={(event) => { event.stopPropagation(); onCloseTab(tab.id); }}
              onMouseEnter={() => setHoveredClose(tab.id)}
              onMouseLeave={() => setHoveredClose(null)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 24, height: 24,
                background: hoveredClose === tab.id ? "var(--bg-hover)" : "transparent",
                border: "none", borderRadius: 4,
                color: hoveredClose === tab.id ? "var(--text)" : "var(--text-dim)",
                cursor: "pointer", padding: 0, flexShrink: 0,
                transition: "background 0.1s, color 0.1s",
              }}
              title="Close"
              aria-label={`Close ${tab.label}`}
            >
              <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <line x1="2" y1="2" x2="8" y2="8" />
                <line x1="8" y1="2" x2="2" y2="8" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
