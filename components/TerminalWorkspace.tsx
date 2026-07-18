"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

interface TerminalTab {
  id: string;
  index: number;
  label: string;
  cwd: string;
  shell: string;
  exited: boolean;
}

interface Props {
  active: boolean;
  activationKey: number;
  cwd: string | null;
  widthMode: "normal" | "wide";
  onWidthModeChange: (mode: "normal" | "wide") => void;
  onEmpty: () => void;
}

const TERMINAL_FONT_FAMILY = '"PiTerminalJetBrainsMonoNerd", "JetBrainsMonoNL Nerd Font Mono", monospace';

function defaultLabel(index: number) {
  return `Terminal ${index}`;
}

async function waitForTerminalFont(fontSize = 13): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  try {
    await document.fonts.load(`${fontSize}px "PiTerminalJetBrainsMonoNerd"`);
    await document.fonts.ready;
  } catch {
    // Browser font loading failure should not prevent opening a terminal.
  }
}

async function postTerminalCommand(id: string, body: unknown) {
  await fetch(`/api/terminal/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => undefined);
}

function TerminalPane({ tab, active, onTitle, onExit }: {
  tab: TerminalTab;
  active: boolean;
  onTitle: (id: string, title: string) => void;
  onExit: (id: string, exitCode: number | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const readyRef = useRef(false);
  const pendingWritesRef = useRef<string[]>([]);
  const lastSeqRef = useRef(0);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resizeSeqRef = useRef(0);
  const pendingResizeRef = useRef<{ cols: number; rows: number; seq: number } | null>(null);

  const flushResize = useCallback(() => {
    const size = pendingResizeRef.current;
    pendingResizeRef.current = null;
    if (!size) return;
    void postTerminalCommand(tab.id, { type: "resize", cols: size.cols, rows: size.rows, seq: size.seq });
  }, [tab.id]);

  const queueResize = useCallback((cols: number, rows: number) => {
    if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 10 || rows < 4) return;
    pendingResizeRef.current = { cols, rows, seq: ++resizeSeqRef.current };
    if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
    resizeTimerRef.current = setTimeout(() => {
      resizeTimerRef.current = null;
      flushResize();
    }, 90);
  }, [flushResize]);

  const fitAndResize = useCallback(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    const container = containerRef.current;
    if (!term || !fit || !container || container.offsetWidth <= 0 || container.offsetHeight <= 0) return;
    try {
      fit.fit();
      queueResize(term.cols, term.rows);
    } catch {
      // xterm fit can throw while the element is detached/hidden.
    }
  }, [queueResize]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let ro: ResizeObserver | null = null;
    let dataDisposable: { dispose: () => void } | null = null;
    let titleDisposable: { dispose: () => void } | null = null;

    void waitForTerminalFont(13).then(() => {
      if (disposed || !containerRef.current) return;
      const term = new Terminal({
        convertEol: false,
        cursorBlink: true,
        cursorStyle: "block",
        scrollback: 10000,
        fontFamily: TERMINAL_FONT_FAMILY,
        fontSize: 13,
        fontWeight: "normal",
        fontWeightBold: "normal",
        lineHeight: 1.2,
        allowProposedApi: false,
        theme: {
          background: "#111111",
          foreground: "#e8e8e8",
          cursor: "#e8e8e8",
          selectionBackground: "#375a7f88",
        },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(containerRef.current);
      termRef.current = term;
      fitRef.current = fit;

      dataDisposable = term.onData((data) => {
        void postTerminalCommand(tab.id, { type: "input", data });
      });
      titleDisposable = term.onTitleChange((title) => onTitle(tab.id, title));

      readyRef.current = true;
      for (const data of pendingWritesRef.current) term.write(data);
      pendingWritesRef.current = [];
      requestAnimationFrame(() => {
        fitAndResize();
        term.clearTextureAtlas();
        term.refresh(0, term.rows - 1);
        if (active) term.focus();
      });

      ro = new ResizeObserver(() => fitAndResize());
      ro.observe(containerRef.current);
    });

    return () => {
      disposed = true;
      readyRef.current = false;
      ro?.disconnect();
      dataDisposable?.dispose();
      titleDisposable?.dispose();
      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [active, fitAndResize, onTitle, tab.id]);

  useEffect(() => {
    const source = new EventSource(`/api/terminal/${encodeURIComponent(tab.id)}/events`);
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as { type?: string; data?: string; seq?: number; exitCode?: number | null };
        if (payload.type === "data" && typeof payload.data === "string") {
          const seq = typeof payload.seq === "number" ? payload.seq : lastSeqRef.current + 1;
          if (seq <= lastSeqRef.current) return;
          lastSeqRef.current = seq;
          if (readyRef.current) termRef.current?.write(payload.data);
          else pendingWritesRef.current.push(payload.data);
        } else if (payload.type === "exit") {
          onExit(tab.id, typeof payload.exitCode === "number" ? payload.exitCode : null);
        }
      } catch {
        // Ignore malformed SSE frames.
      }
    };
    source.onerror = () => {
      // EventSource reconnects automatically.
    };
    return () => source.close();
  }, [onExit, tab.id]);

  useEffect(() => {
    if (active) {
      requestAnimationFrame(() => {
        fitAndResize();
        termRef.current?.focus();
      });
    }
  }, [active, fitAndResize]);

  useEffect(() => () => {
    if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
    flushResize();
  }, [flushResize]);

  return <div ref={containerRef} className="pi-terminal-xterm" style={{ height: "100%", width: "100%", overflow: "hidden", background: "#111" }} />;
}

export function TerminalWorkspace({ active, activationKey, cwd, widthMode, onWidthModeChange, onEmpty }: Props) {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [hoveredClose, setHoveredClose] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tabsRef = useRef<TerminalTab[]>([]);
  tabsRef.current = tabs;

  const activeTab = useMemo(() => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null, [activeTabId, tabs]);

  const createTerminal = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Failed to create terminal");
      const nextIndex = tabsRef.current.length === 0
        ? 0
        : Math.max(...tabsRef.current.map((tab) => tab.index)) + 1;
      const tab: TerminalTab = {
        id: payload.id,
        index: nextIndex,
        label: defaultLabel(nextIndex),
        cwd: payload.cwd,
        shell: payload.shell,
        exited: false,
      };
      setTabs((prev) => [...prev, tab]);
      setActiveTabId(tab.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create terminal");
    } finally {
      setCreating(false);
    }
  }, [creating, cwd]);

  useEffect(() => {
    if (!active || activationKey === 0) return;
    if (tabsRef.current.length === 0) void createTerminal();
    else setActiveTabId((current) => current ?? tabsRef.current[0]?.id ?? null);
  }, [active, activationKey, createTerminal]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      for (const tab of tabsRef.current) {
        const body = new Blob([JSON.stringify({ type: "kill" })], { type: "application/json" });
        navigator.sendBeacon(`/api/terminal/${encodeURIComponent(tab.id)}`, body);
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  const closeTab = useCallback((id: string) => {
    const remaining = tabsRef.current.filter((tab) => tab.id !== id);
    const shouldHide = remaining.length === 0 && tabsRef.current.some((tab) => tab.id === id);
    void fetch(`/api/terminal/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => undefined);
    setTabs(remaining);
    setActiveTabId((current) => {
      if (current !== id) return current;
      return remaining.length > 0 ? remaining[remaining.length - 1].id : null;
    });
    if (shouldHide) queueMicrotask(onEmpty);
  }, [onEmpty]);

  const handleTitle = useCallback(() => {
    // Keep terminal tab labels stable as Terminal N. Shell titles can change
    // frequently and should not affect the user-visible tab counter.
  }, []);

  const handleExit = useCallback((id: string) => {
    closeTab(id);
  }, [closeTab]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#111" }}>
      <div style={{ display: "flex", alignItems: "center", height: 36, flexShrink: 0, background: "var(--bg-panel)", borderBottom: "1px solid var(--border)", paddingRight: 80 }}>
        <div style={{ display: "flex", alignItems: "flex-end", height: 36, flex: 1, overflowX: "auto" }}>
          {tabs.map((tab) => {
            const isActive = tab.id === activeTab?.id;
            return (
              <div
                key={tab.id}
                onClick={() => setActiveTabId(tab.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 6, height: 36,
                  paddingLeft: 12, paddingRight: 6, borderRight: "1px solid var(--border)",
                  background: isActive ? "var(--bg)" : "var(--bg-panel)", color: isActive ? "var(--text)" : "var(--text-muted)",
                  fontSize: 12, maxWidth: 220, minWidth: 118, flexShrink: 0, cursor: "pointer", userSelect: "none",
                }}
                title={`${tab.shell} — ${tab.cwd}`}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: isActive ? 1 : 0.7, flexShrink: 0 }}>
                  <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
                </svg>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{tab.label}</span>
                <button
                  onClick={(event) => { event.stopPropagation(); closeTab(tab.id); }}
                  onMouseEnter={() => setHoveredClose(tab.id)}
                  onMouseLeave={() => setHoveredClose(null)}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24,
                    background: hoveredClose === tab.id ? "var(--bg-hover)" : "transparent", border: "none", borderRadius: 4,
                    color: hoveredClose === tab.id ? "var(--text)" : "var(--text-dim)", cursor: "pointer", padding: 0, flexShrink: 0,
                  }}
                  title="Close and kill shell"
                  aria-label={`Close ${tab.label}`}
                >
                  <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                    <line x1="2" y1="2" x2="8" y2="8" /><line x1="8" y1="2" x2="2" y2="8" />
                  </svg>
                </button>
              </div>
            );
          })}
          {tabs.length === 0 && (
            <div style={{ height: 36, display: "flex", alignItems: "center", padding: "0 12px", color: "var(--text-dim)", fontSize: 12 }}>
              {creating ? "Creating terminal…" : "No terminal"}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => onWidthModeChange(widthMode === "wide" ? "normal" : "wide")}
          title={widthMode === "wide" ? "Use normal terminal width" : "Use wide terminal width"}
          style={{ width: 32, height: 28, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--border)", borderRadius: 6, background: widthMode === "wide" ? "var(--bg-selected)" : "transparent", color: "var(--text-muted)", cursor: "pointer", marginRight: 6, flexShrink: 0 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M16 3h3a2 2 0 0 1 2 2v3" /><path d="M8 21H5a2 2 0 0 1-2-2v-3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => void createTerminal()}
          disabled={creating}
          title="New terminal"
          aria-label="New terminal"
          style={{ width: 32, height: 28, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--border)", borderRadius: 6, background: "transparent", color: "var(--text-muted)", cursor: creating ? "default" : "pointer", opacity: creating ? 0.5 : 1, flexShrink: 0 }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        </button>
      </div>

      {error ? (
        <div style={{ padding: 12, color: "#fca5a5", fontSize: 12, background: "#111" }}>{error}</div>
      ) : null}

      <div style={{ flex: 1, minHeight: 0, position: "relative", background: "#111" }}>
        {active && activeTab ? (
          <TerminalPane
            key={activeTab.id}
            tab={activeTab}
            active={active}
            onTitle={handleTitle}
            onExit={handleExit}
          />
        ) : null}
      </div>
    </div>
  );
}
