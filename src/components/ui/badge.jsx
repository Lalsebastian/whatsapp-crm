import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 [&>svg]:pointer-events-none',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground',
        secondary: 'bg-secondary text-secondary-foreground',
        destructive: 'bg-destructive/12 text-destructive ring-1 ring-inset ring-destructive/25',
        outline: 'border text-foreground',
        accent: 'bg-accent/12 text-accent ring-1 ring-inset ring-accent/25',
        success: 'bg-success/12 text-success ring-1 ring-inset ring-success/25',
        warning: 'bg-warning/14 text-warning ring-1 ring-inset ring-warning/30',
        info: 'bg-info/12 text-info ring-1 ring-inset ring-info/25',
        neutral: 'bg-neutral-status/12 text-neutral-status ring-1 ring-inset ring-neutral-status/25',
      },
    },
    defaultVariants: { variant: 'default' },
  }
);

function Badge({ className, variant, asChild = false, ...props }) {
  const Comp = asChild ? Slot : 'span';
  return <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
