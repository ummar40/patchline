import type { ReactNode } from "react";
import type { Tone } from "@/web/copy";
import { cn } from "./cn";

export function PageHeader(props: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
      <div className="min-w-0 space-y-1">
        {props.eyebrow ? <div className="text-sm text-muted">{props.eyebrow}</div> : null}
        <h1 className="text-xl font-semibold tracking-tight text-balance">{props.title}</h1>
        {props.description ? (
          <p className="max-w-2xl text-sm text-muted">{props.description}</p>
        ) : null}
      </div>
      {props.actions ? (
        <div className="flex shrink-0 items-center gap-2">{props.actions}</div>
      ) : null}
    </header>
  );
}

export function Section(props: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{props.title}</h2>
          {props.description ? <p className="text-sm text-muted">{props.description}</p> : null}
        </div>
        {props.actions}
      </div>
      {props.children}
    </section>
  );
}

export function Panel(props: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("rounded-md border border-border bg-background", props.className)}>
      {props.children}
    </div>
  );
}

export function EmptyState(props: { title: string; description: ReactNode; action?: ReactNode }) {
  return (
    <Panel className="flex flex-col items-start gap-3 border-dashed px-6 py-8">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{props.title}</h3>
        <p className="max-w-xl text-sm text-muted">{props.description}</p>
      </div>
      {props.action}
    </Panel>
  );
}

const noticeTones: Record<Tone, string> = {
  neutral: "border-border bg-surface",
  info: "border-info/30 bg-info-subtle",
  success: "border-success/30 bg-success-subtle",
  warning: "border-warning/30 bg-warning-subtle",
  danger: "border-danger/30 bg-danger-subtle",
};

export function Notice(props: {
  tone?: Tone;
  title?: string;
  children: ReactNode;
  role?: "alert" | "status";
}) {
  return (
    <div
      className={cn("rounded-md border px-4 py-3 text-sm", noticeTones[props.tone ?? "neutral"])}
      role={props.role}
    >
      {props.title ? <p className="font-medium">{props.title}</p> : null}
      <div className={cn("text-foreground/90", props.title && "mt-1")}>{props.children}</div>
    </div>
  );
}

export function DefinitionList(props: { items: { term: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
      {props.items.map((item) => (
        <div className="min-w-0" key={item.term}>
          <dt className="text-xs text-muted">{item.term}</dt>
          <dd className="mt-0.5 truncate">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
