import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

/**
 * Minimal toast host — lightweight, transient feedback for copy actions and
 * other non-modal confirmations. Mirrors ZCode's toast surface, trimmed to
 * what the desktop shell needs: one auto-dismissing stack, no queueing.
 */

export type ToastTone = "default" | "success" | "danger";

type Toast = {
  id: number;
  message: string;
  tone: ToastTone;
};

type ToastContextValue = {
  showToast: (message: string, tone?: ToastTone) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_TTL_MS = 2200;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const showToast = useCallback((message: string, tone: ToastTone = "default") => {
    const id = nextId.current++;
    setToasts((prev) => [...prev.slice(-2), { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, TOAST_TTL_MS);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="toast-host" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.tone}`}>
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Renderers outside the provider (defensive) still get a working no-op.
    return { showToast: () => {} };
  }
  return ctx;
}
