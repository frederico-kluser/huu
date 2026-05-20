import { forwardRef, type ReactNode } from 'react';
import { Button, type ButtonProps } from './Button';

export interface IconButtonProps extends Omit<ButtonProps, 'children'> {
  'aria-label': string;
  children: ReactNode;
}

/**
 * Button containing a single icon (typically `lucide-react`). `aria-label`
 * is REQUIRED for screen readers since there is no visible text.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, size = 'md', children, ...rest },
  ref,
) {
  const dim = size === 'sm' ? 'h-8 w-8 px-0' : size === 'lg' ? 'h-12 w-12 px-0' : 'h-10 w-10 px-0';
  return (
    <Button ref={ref} size={size} className={`${dim} ${className ?? ''}`} {...rest}>
      {children}
    </Button>
  );
});
