import { type VariantProps, cva } from "class-variance-authority";
import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "./cn";

export const buttonStyles = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "border-primary bg-primary text-primary-foreground hover:opacity-90",
        secondary: "border-border-strong bg-background text-foreground hover:bg-subtle",
        ghost: "border-transparent text-muted hover:bg-subtle hover:text-foreground",
        danger: "border-danger/40 bg-background text-danger hover:bg-danger-subtle",
      },
      size: {
        sm: "h-8 px-3",
        md: "h-9 px-4",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

type ButtonStyleProps = VariantProps<typeof buttonStyles>;

export function Button({
  className,
  variant,
  size,
  ...props
}: ComponentProps<"button"> & ButtonStyleProps) {
  return <button className={cn(buttonStyles({ variant, size }), className)} {...props} />;
}

export function ButtonLink({
  className,
  variant,
  size,
  ...props
}: ComponentProps<typeof Link> & ButtonStyleProps) {
  return <Link className={cn(buttonStyles({ variant, size }), className)} {...props} />;
}

export function ExternalButtonLink({
  className,
  variant,
  size,
  ...props
}: ComponentProps<"a"> & ButtonStyleProps) {
  return (
    <a
      className={cn(buttonStyles({ variant, size }), className)}
      rel="noreferrer"
      target="_blank"
      {...props}
    />
  );
}
