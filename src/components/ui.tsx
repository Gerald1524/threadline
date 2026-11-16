import type { ComponentProps, ReactNode } from "react";
import type { Classification } from "@/lib/engine/types";

export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");

const BTN = {
  primary: "bg-brand-700 text-white hover:bg-brand-800 border-transparent",
  secondary: "bg-white text-stone-800 border-stone-300 hover:bg-stone-50",
  danger: "bg-white text-rose-700 border-rose-300 hover:bg-rose-50",
  ghost: "bg-transparent text-stone-700 border-transparent hover:bg-stone-100",
};
export const btn = (variant: keyof typeof BTN = "secondary", size: "sm" | "md" = "md") =>
  cx("inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none", size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm", BTN[variant]);

export function Button({ variant = "secondary", size = "md", className, ...p }: ComponentProps<"button"> & { variant?: keyof typeof BTN; size?: "sm" | "md" }) {
  return <button {...p} className={cx(btn(variant, size), className)} />;
}

const TONE = {
  neutral: "bg-stone-100 text-stone-700 ring-stone-200", brand: "bg-brand-50 text-brand-800 ring-brand-100", amber: "bg-amber-50 text-amber-800 ring-amber-200", sky: "bg-sky-50 text-sky-800 ring-sky-200",
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200", violet: "bg-violet-50 text-violet-800 ring-violet-200", rose: "bg-rose-50 text-rose-800 ring-rose-200", slate: "bg-slate-100 text-slate-700 ring-slate-200",
};
export type Tone = keyof typeof TONE;
export function Badge({ tone = "neutral", children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return <span title={title} className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", TONE[tone], className)}>{children}</span>;
}

/** One visual language for "who is asserting what", used in answers, timelines and the source panel. */
export const CLASS_TONE: Record<Classification, { tone: Tone; bar: string; short: string }> = {
  allegation: { tone: "amber", bar: "border-l-amber-400", short: "Reported" },
  staff_observation: { tone: "sky", bar: "border-l-sky-500", short: "Staff observed" },
  documented_action: { tone: "slate", bar: "border-l-slate-400", short: "Action" },
  statement: { tone: "neutral", bar: "border-l-stone-400", short: "Statement" },
  independently_supported: { tone: "green", bar: "border-l-emerald-500", short: "Two sources agree" },
  tentative_link: { tone: "violet", bar: "border-l-violet-400", short: "Tentative" },
  missing_evidence: { tone: "rose", bar: "border-l-rose-400", short: "Not in the records" },
  note: { tone: "neutral", bar: "border-l-stone-300", short: "Note" },
};

export const STATUS_TONE: Record<string, Tone> = {
  open: "amber", investigating: "sky", awaiting_response: "violet", resolved: "green", closed: "neutral", pending: "amber", approved: "green", denied: "rose",
  assigned: "sky", in_progress: "sky", on_hold: "violet", completed: "green", cancelled: "neutral", active: "green", paused: "amber", disconnected: "rose", planned: "neutral",
  queued: "amber", running: "sky", succeeded: "green", failed: "rose", draft: "amber", sent: "green", proposed: "amber", executed: "green", rejected: "neutral",
};
export const StatusBadge = ({ status }: { status: string }) => <Badge tone={STATUS_TONE[status] ?? "neutral"}>{status.replace(/_/g, " ")}</Badge>;

export function Card({ children, className, ...p }: ComponentProps<"section">) {
  return <section {...p} className={cx("rounded-xl border border-stone-200 bg-white shadow-[0_1px_2px_rgb(0_0_0/0.04)]", className)}>{children}</section>;
}
export function CardHeader({ title, hint, right }: { title: ReactNode; hint?: ReactNode; right?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-100 px-5 py-3.5">
      <div>
        <h2 className="text-sm font-semibold text-stone-900">{title}</h2>
        {hint ? <p className="mt-0.5 text-xs text-stone-500">{hint}</p> : null}
      </div>
      {right}
    </header>
  );
}
export function PageHeader({ title, lead, right }: { title: string; lead?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-stone-900">{title}</h1>
        {lead ? <p className="mt-1 max-w-3xl text-sm text-stone-600">{lead}</p> : null}
      </div>
      {right}
    </div>
  );
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-stone-300 bg-white px-6 py-10 text-center">
      <p className="text-sm font-medium text-stone-800">{title}</p>
      {children ? <p className="mx-auto mt-1 max-w-md text-sm text-stone-500">{children}</p> : null}
    </div>
  );
}
export function Notice({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <div role="note" className={cx("rounded-lg px-3.5 py-2.5 text-sm ring-1 ring-inset", TONE[tone])}>{children}</div>;
}
export const inputCls = "block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-brand-600";
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-stone-700">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-stone-500">{hint}</span> : null}
    </label>
  );
}
export const th = "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-stone-500";
export const td = "px-3 py-2.5 align-top text-sm text-stone-800";
