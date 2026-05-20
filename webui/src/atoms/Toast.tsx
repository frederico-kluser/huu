import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle, Info, X } from 'lucide-react';
import { cn } from '@/lib/cn';

export type ToastTone = 'success' | 'warning' | 'error' | 'info';

export interface ToastInput {
  tone?: ToastTone;
  title: string;
  description?: string;
  /** ms before auto-dismiss. Default 4000. Set 0 to disable. */
  durationMs?: number;
}

interface ToastInternal extends Required<Omit<ToastInput, 'description'>> {
  id: number;
  description?: string;
}

export interface ToastContextValue {
  show: (toast: ToastInput) => void;
  dismiss: (id: number) => void;
  toasts: ToastInternal[];
}

export const ToastContext = createContext<ToastContextValue | null>(null);
export type { ToastInternal };

let toastSeq = 0;

/** Provider — wrap the app root in this and render <ToastHost /> below. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastInternal[]>([]);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const show = useCallback(
    (input: ToastInput) => {
      const id = ++toastSeq;
      const t: ToastInternal = {
        id,
        tone: input.tone ?? 'info',
        title: input.title,
        description: input.description,
        durationMs: input.durationMs ?? 4000,
      };
      setToasts((prev) => [...prev, t]);
      if (t.durationMs > 0) {
        const timer = setTimeout(() => dismiss(id), t.durationMs);
        timers.current.set(id, timer);
      }
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of map.values()) clearTimeout(t);
      map.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(() => ({ show, dismiss, toasts }), [show, dismiss, toasts]);
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

/** Hook for emitting toasts from anywhere inside `<ToastProvider>`. */
export function useToast(): { show: (t: ToastInput) => void; dismiss: (id: number) => void } {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return { show: ctx.show, dismiss: ctx.dismiss };
}

const toneIcon: Record<ToastTone, typeof CheckCircle> = {
  success: CheckCircle,
  warning: AlertTriangle,
  error: AlertCircle,
  info: Info,
};

const toneCls: Record<ToastTone, string> = {
  success: 'border-success/40 text-success',
  warning: 'border-warning/40 text-warning',
  error: 'border-error/40 text-error',
  info: 'border-info/40 text-info',
};

/** Renders one toast card. Internal — driven by ToastHost. */
export function Toast({ toast, onDismiss }: { toast: ToastInternal; onDismiss: () => void }) {
  const Icon = toneIcon[toast.tone];
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'pointer-events-auto flex w-80 items-start gap-3 rounded-md border bg-background/95 p-3 shadow-lg backdrop-blur',
        toneCls[toast.tone],
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground">{toast.title}</div>
        {toast.description ? (
          <div className="mt-0.5 text-xs text-foreground/70">{toast.description}</div>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={onDismiss}
        className="shrink-0 text-foreground/50 hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
