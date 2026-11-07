import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

const fieldStyles =
  "w-full rounded-md border border-border-strong bg-background px-3 text-sm text-foreground placeholder:text-muted disabled:opacity-60 aria-invalid:border-danger";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(fieldStyles, "h-9", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(fieldStyles, "min-h-28 py-2 leading-6", className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(fieldStyles, "h-9", className)} {...props} />;
}

export function Field(props: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-baseline gap-2 text-sm font-medium" htmlFor={props.id}>
        {props.label}
        {props.optional ? <span className="text-xs font-normal text-muted">Optional</span> : null}
      </label>
      {props.children}
      {props.error ? (
        <p className="text-sm text-danger" id={`${props.id}-error`} role="alert">
          {props.error}
        </p>
      ) : props.hint ? (
        <p className="text-sm text-muted" id={`${props.id}-hint`}>
          {props.hint}
        </p>
      ) : null}
    </div>
  );
}
