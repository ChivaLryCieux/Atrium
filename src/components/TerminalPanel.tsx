import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

export type TerminalSession = {
  id: string;
  title: string;
  cwd: string;
};

type TerminalPanelProps = {
  terminals: TerminalSession[];
  activeId: string | null;
  cwd: string;
  onSelect: (id: string) => void;
  onCreated: (info: TerminalSession) => void;
  onClosed: (id: string, code?: number) => void;
  onCloseTerminal: (id: string) => void;
};

function displayTitles(terminals: TerminalSession[]): string[] {
  // Same cwd => same backend title: disambiguate with a counter suffix.
  const counts = new Map<string, number>();
  return terminals.map((t, index) => {
    const base = (t.title || "").trim() || `终端 ${index + 1}`;
    const n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n);
    return n > 1 ? `${base} ${n}` : base;
  });
}

type InstanceEntry = { term: Terminal; fit: FitAddon; exited: boolean };

export function TerminalPanel({
  terminals,
  activeId,
  cwd,
  onSelect,
  onCreated,
  onClosed,
  onCloseTerminal,
}: TerminalPanelProps) {
  const containerRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const instancesRef = useRef<Map<string, InstanceEntry>>(new Map());
  const spawnedRef = useRef<Set<string>>(new Set());
  const activeIdRef = useRef<string | null>(activeId);
  activeIdRef.current = activeId;

  const onCreatedRef = useRef(onCreated);
  const onClosedRef = useRef(onClosed);
  onCreatedRef.current = onCreated;
  onClosedRef.current = onClosed;

  // Spawn backend PTY once per tab. Backend id == tab id.
  useEffect(() => {
    for (const t of terminals) {
      if (spawnedRef.current.has(t.id)) continue;
      spawnedRef.current.add(t.id);
      invoke<{ id: string; title: string; cwd: string }>("create_terminal", {
        id: t.id,
        cwd: t.cwd || undefined,
        cols: 120,
        rows: 30,
      })
        .then((info) => onCreatedRef.current({ id: t.id, title: info.title || t.title, cwd: info.cwd || t.cwd }))
        .catch((err) => {
          console.error("创建终端失败:", err);
          spawnedRef.current.delete(t.id);
          onClosedRef.current(t.id);
        });
    }
  }, [terminals]);

  // Mount one xterm instance per tab.
  useEffect(() => {
    for (const t of terminals) {
      if (instancesRef.current.has(t.id)) continue;
      const el = containerRefs.current.get(t.id);
      if (!el) continue;
      const term = new Terminal({
        cursorBlink: true,
        cursorStyle: "bar",
        fontSize: 13,
        fontFamily: "'JetBrains Mono','Fira Code',Consolas,Menlo,monospace",
        theme: {
          background: "#f4f4f5",
          foreground: "#18181b",
          cursor: "#18181b",
          cursorAccent: "#f4f4f5",
          selectionBackground: "rgba(24, 24, 27, 0.18)",
          selectionForeground: "#18181b",
          black: "#3f3f46",
          red: "#dc2626",
          green: "#16a34a",
          yellow: "#a16207",
          blue: "#2563eb",
          magenta: "#9333ea",
          cyan: "#0891b2",
          white: "#d4d4d8",
          brightBlack: "#71717a",
          brightRed: "#ef4444",
          brightGreen: "#22c55e",
          brightYellow: "#ca8a04",
          brightBlue: "#3b82f6",
          brightMagenta: "#a855f7",
          brightCyan: "#06b6d4",
          brightWhite: "#fafafa",
        },
        scrollback: 5000,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.loadAddon(new WebLinksAddon());
      term.open(el);
      instancesRef.current.set(t.id, { term, fit, exited: false });
      term.onData((data) => {
        invoke("write_terminal", { id: t.id, data }).catch((err) => console.error("终端写入失败:", err));
      });
      requestAnimationFrame(() => {
        try {
          fit.fit();
          const dims = fit.proposeDimensions();
          if (dims && dims.cols > 0) {
            invoke("resize_terminal", { id: t.id, cols: dims.cols, rows: dims.rows }).catch(() => undefined);
          }
        } catch {
          /* noop */
        }
      });
    }
    for (const [id, entry] of Array.from(instancesRef.current.entries())) {
      if (!terminals.some((t) => t.id === id)) {
        try {
          entry.term.dispose();
        } catch {
          /* noop */
        }
        instancesRef.current.delete(id);
      }
    }
  });

  // Backend output / exit events.
  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    listen<{ id: string; data: string }>("terminal-output", (event) => {
      instancesRef.current.get(event.payload.id)?.term.write(event.payload.data);
    }).then((fn) => {
      if (!disposed) unlisteners.push(fn);
      else fn();
    });
    listen<{ id: string; code?: number }>("terminal-exit", (event) => {
      const entry = instancesRef.current.get(event.payload.id);
      if (entry && !entry.exited) {
        entry.exited = true;
        entry.term.writeln("\r\n[进程已退出]");
      }
      onClosedRef.current(event.payload.id, event.payload.code ?? undefined);
    }).then((fn) => {
      if (!disposed) unlisteners.push(fn);
      else fn();
    });
    return () => {
      disposed = true;
      unlisteners.forEach((fn) => fn());
    };
  }, []);

  // Resize the active terminal with the window.
  useEffect(() => {
    const onResize = () => {
      const id = activeIdRef.current;
      if (!id) return;
      const entry = instancesRef.current.get(id);
      if (!entry) return;
      try {
        entry.fit.fit();
        const dims = entry.fit.proposeDimensions();
        if (dims && dims.cols > 0) {
          invoke("resize_terminal", { id, cols: dims.cols, rows: dims.rows }).catch(() => undefined);
        }
      } catch {
        /* noop */
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const titles = displayTitles(terminals);

  return (
    <section className="terminal-dock" aria-label="嵌入式终端">
      <div className="terminal-dock-tabs">
        <div className="terminal-tabs-left">
          {terminals.map((t, index) => {
            const label = titles[index];
            return (
              <div
                key={t.id}
                role="tab"
                aria-selected={t.id === activeId}
                className={`terminal-tab ${t.id === activeId ? "active" : ""}`}
                title={t.cwd || t.title}
                onClick={() => onSelect(t.id)}
              >
                <span className="terminal-tab-dot" />
                <span className="terminal-tab-label">{label}</span>
                <button
                  type="button"
                  className="terminal-tab-close"
                  title={`关闭${label}`}
                  aria-label={`关闭${label}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTerminal(t.id);
                  }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="5" y1="5" x2="19" y2="19" strokeLinecap="round" />
                    <line x1="19" y1="5" x2="5" y2="19" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
        <div className="terminal-tabs-actions">
          <span className="terminal-cwd" title={cwd}>{cwd}</span>
        </div>
      </div>
      <div className="terminal-dock-body">
        {terminals.map((t) => (
          <div
            key={t.id}
            className="terminal-instance"
            style={{ display: t.id === activeId ? "block" : "none" }}
            ref={(el) => {
              if (el) containerRefs.current.set(t.id, el);
              else containerRefs.current.delete(t.id);
            }}
          />
        ))}
      </div>
    </section>
  );
}

