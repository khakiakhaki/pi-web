import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { IPty } from "node-pty";
import { getAllowedFileRoots, isFilePathAllowed } from "./file-access";

const DEFAULT_SHELL = "/bin/bash";
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const BACKLOG_LIMIT = 256 * 1024;

export interface TerminalSessionInfo {
  id: string;
  cwd: string;
  shell: string;
  cols: number;
  rows: number;
  exited: boolean;
  exitCode: number | null;
  createdAt: number;
}

type TerminalSubscriber = (event: TerminalEvent) => void;

type TerminalEvent =
  | { type: "data"; data: string; seq: number }
  | { type: "exit"; exitCode: number | null };

interface BacklogChunk {
  seq: number;
  data: string;
}

interface TerminalSession extends TerminalSessionInfo {
  pty: IPty;
  nextSeq: number;
  lastResizeSeq: number;
  backlogSize: number;
  backlog: BacklogChunk[];
  subscribers: Set<TerminalSubscriber>;
}

declare global {
  var __piTerminalSessions: Map<string, TerminalSession> | undefined;
}

function sessions(): Map<string, TerminalSession> {
  if (!globalThis.__piTerminalSessions) globalThis.__piTerminalSessions = new Map();
  return globalThis.__piTerminalSessions;
}

function terminalShell(): string {
  const configured = process.env.PI_WEB_TERMINAL_SHELL?.trim();
  return configured || DEFAULT_SHELL;
}

function buildTerminalEnv(shell: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };

  // The web terminal is not the terminal that launched pi-web. If pi-web was
  // started inside Kitty/WezTerm/Ghostty/etc., inheriting those variables makes
  // TUI apps such as yazi send graphics/query protocols that a browser terminal
  // may not support, which can render raw sequences like `Gi=...`.
  for (const key of Object.keys(env)) {
    if (
      key.startsWith("KITTY_")
      || key.startsWith("WEZTERM_")
      || key.startsWith("GHOSTTY_")
      || key.startsWith("KONSOLE_")
      || key.startsWith("VTE_")
      || key === "TERM_PROGRAM"
      || key === "TERM_PROGRAM_VERSION"
      || key === "WT_SESSION"
      || key === "XDG_SESSION_TYPE"
      || key === "DISPLAY"
      || key === "WAYLAND_DISPLAY"
      || key === "LC_TERMINAL"
      || key === "LC_TERMINAL_VERSION"
    ) {
      delete env[key];
    }
  }

  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  env.SHELL = shell;
  return env;
}

function appendBacklog(session: TerminalSession, event: Extract<TerminalEvent, { type: "data" }>) {
  session.backlog.push({ seq: event.seq, data: event.data });
  session.backlogSize += event.data.length;
  while (session.backlogSize > BACKLOG_LIMIT && session.backlog.length > 0) {
    const removed = session.backlog.shift();
    if (removed) session.backlogSize -= removed.data.length;
  }
}

function emit(session: TerminalSession, event: TerminalEvent) {
  if (event.type === "data") appendBacklog(session, event);
  for (const subscriber of session.subscribers) subscriber(event);
}

async function resolveCwd(requestedCwd: unknown): Promise<string> {
  if (typeof requestedCwd !== "string" || !requestedCwd.trim()) return homedir();
  const cwd = path.resolve(requestedCwd);
  try {
    const info = statSync(cwd);
    if (!info.isDirectory()) return homedir();
  } catch {
    return homedir();
  }

  const allowedRoots = await getAllowedFileRoots();
  return isFilePathAllowed(cwd, allowedRoots) ? cwd : homedir();
}

export async function createTerminalSession(options: { cwd?: unknown; cols?: unknown; rows?: unknown } = {}): Promise<TerminalSessionInfo> {
  const cwd = await resolveCwd(options.cwd);
  const cols = typeof options.cols === "number" && Number.isFinite(options.cols) ? Math.max(10, Math.floor(options.cols)) : DEFAULT_COLS;
  const rows = typeof options.rows === "number" && Number.isFinite(options.rows) ? Math.max(4, Math.floor(options.rows)) : DEFAULT_ROWS;
  const shell = terminalShell();

  if (!path.isAbsolute(shell) || !existsSync(shell)) {
    throw new Error(`Terminal shell not found: ${shell}`);
  }

  const nodePty = await import("node-pty");
  const id = randomUUID();
  const pty = nodePty.spawn(shell, [], {
    name: "xterm-256color",
    cols,
    rows,
    cwd,
    env: buildTerminalEnv(shell),
  });

  const session: TerminalSession = {
    id,
    cwd,
    shell,
    cols,
    rows,
    exited: false,
    exitCode: null,
    createdAt: Date.now(),
    pty,
    nextSeq: 1,
    lastResizeSeq: 0,
    backlogSize: 0,
    backlog: [],
    subscribers: new Set(),
  };
  sessions().set(id, session);

  pty.onData((data) => emit(session, { type: "data", data, seq: session.nextSeq++ }));
  pty.onExit(({ exitCode }) => {
    session.exited = true;
    session.exitCode = exitCode;
    emit(session, { type: "exit", exitCode });
  });

  return toInfo(session);
}

function toInfo(session: TerminalSession): TerminalSessionInfo {
  return {
    id: session.id,
    cwd: session.cwd,
    shell: session.shell,
    cols: session.cols,
    rows: session.rows,
    exited: session.exited,
    exitCode: session.exitCode,
    createdAt: session.createdAt,
  };
}

export function getTerminalSession(id: string): TerminalSessionInfo | null {
  const session = sessions().get(id);
  return session ? toInfo(session) : null;
}

export function writeTerminalInput(id: string, data: unknown): boolean {
  const session = sessions().get(id);
  if (!session || session.exited || typeof data !== "string") return false;
  session.pty.write(data);
  return true;
}

export function resizeTerminal(id: string, cols: unknown, rows: unknown, seq?: unknown): boolean {
  const session = sessions().get(id);
  if (!session || session.exited || typeof cols !== "number" || typeof rows !== "number") return false;
  if (typeof seq === "number" && Number.isFinite(seq)) {
    if (seq < session.lastResizeSeq) return true;
    session.lastResizeSeq = seq;
  }
  const nextCols = Math.max(10, Math.floor(cols));
  const nextRows = Math.max(4, Math.floor(rows));
  session.cols = nextCols;
  session.rows = nextRows;
  session.pty.resize(nextCols, nextRows);
  return true;
}

export function killTerminalSession(id: string): boolean {
  const session = sessions().get(id);
  if (!session) return false;
  sessions().delete(id);
  try {
    if (!session.exited) session.pty.kill();
  } catch {
    // ignore a process that already exited
  }
  for (const subscriber of session.subscribers) subscriber({ type: "exit", exitCode: session.exitCode });
  session.subscribers.clear();
  return true;
}

export function subscribeTerminal(id: string, subscriber: TerminalSubscriber): (() => void) | null {
  const session = sessions().get(id);
  if (!session) return null;
  for (const chunk of session.backlog) subscriber({ type: "data", data: chunk.data, seq: chunk.seq });
  if (session.exited) subscriber({ type: "exit", exitCode: session.exitCode });
  session.subscribers.add(subscriber);
  return () => session.subscribers.delete(subscriber);
}
