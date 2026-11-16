"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, BookOpen, ClipboardCheck, Database, FileText, FolderOpen, Inbox, MessagesSquare, Repeat, ShieldCheck, Wrench } from "lucide-react";
import { cx } from "./ui";

const ICONS = { ask: MessagesSquare, cases: FolderOpen, activity: Activity, workorders: Wrench, approvals: ClipboardCheck, policies: BookOpen, handoffs: Repeat, review: Inbox, reports: FileText, sources: Database, privacy: ShieldCheck };
export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: number };

export function Nav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Primary" className="flex gap-1 overflow-x-auto px-3 py-2 lg:flex-col lg:overflow-visible lg:px-3 lg:py-4">
      {items.map((i) => {
        const Icon = ICONS[i.icon];
        const active = i.href === "/" ? path === "/" : path.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined}
            className={cx("flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors", active ? "bg-brand-800 text-white" : "text-brand-50/80 hover:bg-white/10 hover:text-white")}>
            <Icon size={16} aria-hidden />
            <span className="flex-1 whitespace-nowrap">{i.label}</span>
            {i.badge ? <span className={cx("rounded-full px-1.5 text-[11px] font-semibold", active ? "bg-white/20" : "bg-amber-400 text-amber-950")}>{i.badge}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
