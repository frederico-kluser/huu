import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface FullscreenModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}

/** Centered overlay modal with backdrop + close button. Esc closes. */
export function FullscreenModal({ open, onClose, title, children, className }: FullscreenModalProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-foreground/50" onClick={onClose} aria-hidden />
      <div
        className={cn(
          'relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-foreground/15 bg-background shadow-2xl',
          className,
        )}
      >
        <div className="flex items-center justify-between border-b border-foreground/10 px-4 py-3">
          <h2 className="text-sm font-medium">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-foreground/5"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4">{children}</div>
      </div>
    </div>
  );
}
