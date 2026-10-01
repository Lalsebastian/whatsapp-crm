import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-[color,background-color,border-color,box-shadow,transform] duration-200 ease-out outline-none hover:-translate-y-0.5 active:translate-y-px active:scale-[.985] motion-reduce:transform-none focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:border-ring disabled:pointer-events-none disabled:opacity-50 disabled:transform-none [&_svg]:pointer-events-none [&_svg]:transition-transform [&_svg]:duration-200 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'clay-button clay-button-primary text-primary-foreground',
        accent: 'clay-button clay-button-accent text-accent-foreground',
        destructive: 'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
        outline: 'clay-button clay-button-outline border bg-background/85 backdrop-blur hover:border-primary/30 hover:bg-primary/5 hover:text-foreground',
        secondary: 'clay-button clay-button-secondary bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-muted hover:text-foreground',
        link: 'text-accent underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        sm: 'h-8 rounded-[.7rem] gap-1.5 px-3 has-[>svg]:px-2.5 text-[13px]',
        lg: 'h-10 rounded-[.85rem] px-6 has-[>svg]:px-4',
        icon: 'size-9',
        'icon-sm': 'size-8',
        'icon-lg': 'size-11',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
);

function Button({ className, variant, size, asChild = false, ...props }) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
