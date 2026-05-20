import { useContext } from 'react';
import { Toast, ToastContext } from './Toast';

/**
 * Renders the toast stack (top-right) for the nearest `<ToastProvider>`.
 * Place once near the app root, below the provider.
 */
export function ToastHost() {
  const ctx = useContext(ToastContext);
  if (!ctx) return null;
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed right-4 top-4 z-[100] flex flex-col gap-2"
    >
      {ctx.toasts.map((t) => (
        <Toast key={t.id} toast={t} onDismiss={() => ctx.dismiss(t.id)} />
      ))}
    </div>
  );
}
