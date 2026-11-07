import type { ReactNode } from "react";
import type { Tone } from "@/web/copy";
import { cn } from "./cn";

const tones: Record<Tone, string> = {
  neutral: "border-border-strong bg-subtle text-muted",
  info: "border-info/30 bg-info-subtle text-info",
  success: "border-success/30 bg-success-subtle text-success",
  warning: "border-warning/30 bg-warning-subtle text-warning",
  danger: "border-danger/30 bg-danger-subtle text-danger",
};

export function Badge(props: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-5.5 items-center gap-1.5 rounded-full border px-2 text-xs font-medium whitespace-nowrap",
        tones[props.tone ?? "neutral"],
        props.className,
      )}
    >
      {props.children}
    </span>
  );
}
