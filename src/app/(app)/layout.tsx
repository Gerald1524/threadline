import { and, eq, sql } from "drizzle-orm";
import { logoutAction, switchPropertyAction } from "@/app/actions";
import { ROLE_LABEL, can, scopeOf } from "@/lib/access";
import { listAccessibleProperties, requireContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { approvals, reviewItems } from "@/lib/db/schema";
import { Nav, type NavItem } from "@/components/shell";
import { SourcePanelProvider } from "@/components/source-panel";
import { Badge, btn } from "@/components/ui";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const db = await getDb();
  const { options } = await listAccessibleProperties(ctx.userId);
  const n = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
  const reviewN = can(ctx, "review.read") ? await n(db.select({ n: sql<number>`count(*)::int` }).from(reviewItems).where(and(scopeOf(ctx, reviewItems), eq(reviewItems.status, "open")))) : 0;
  const approvalN = can(ctx, "approvals.decide") ? await n(db.select({ n: sql<number>`count(*)::int` }).from(approvals).where(and(scopeOf(ctx, approvals), eq(approvals.status, "pending")))) : 0;
  const items: NavItem[] = [
    { href: "/", label: "Ask", icon: "ask" },
    { href: "/cases", label: "Cases", icon: "cases" },
    { href: "/activity", label: "Activity log", icon: "activity" },
    { href: "/work-orders", label: "Work orders", icon: "workorders" },
    { href: "/approvals", label: "Approvals", icon: "approvals", badge: approvalN },
    { href: "/policies", label: "Policies", icon: "policies" },
    { href: "/handoffs", label: "Handoffs", icon: "handoffs" },
    ...(can(ctx, "review.read") ? [{ href: "/review", label: "Review inbox", icon: "review" as const, badge: reviewN }] : []),
    ...(can(ctx, "reports.read") ? [{ href: "/reports", label: "Reports", icon: "reports" as const }] : []),
    ...(can(ctx, "ingest.run") ? [{ href: "/sources", label: "Sources", icon: "sources" as const }] : []),
    ...(can(ctx, "privacy.view") ? [{ href: "/settings", label: "Data & Privacy", icon: "privacy" as const }] : []),
  ];
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="bg-brand-900 text-white lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto">
        <div className="flex items-center gap-2.5 px-5 pt-5 lg:pb-2">
          <svg width="24" height="24" viewBox="0 0 26 26" fill="none" aria-hidden><rect width="26" height="26" rx="7" fill="#134e4a" /><path d="M7 8h12M7 13h8M7 18h10" stroke="#fff" strokeWidth="2" strokeLinecap="round" /><circle cx="19" cy="13" r="1.6" fill="#5eead4" /></svg>
          <span className="text-[15px] font-semibold tracking-tight">Threadline</span>
        </div>
        <Nav items={items} />
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 bg-white/90 px-5 py-2.5 backdrop-blur lg:px-8">
          <div className="flex items-center gap-3">
            {options.length > 1 ? (
              <form action={switchPropertyAction} className="flex items-center gap-1.5">
                <label htmlFor="propertyId" className="sr-only">Property</label>
                <select id="propertyId" name="propertyId" defaultValue={ctx.propertyId} className="rounded-md border border-stone-300 bg-white px-2 py-1 text-sm font-medium">
                  {options.map((o) => <option key={o.propertyId} value={o.propertyId}>{o.propertyName}</option>)}
                </select>
                <button className={btn("ghost", "sm")}>Switch</button>
              </form>
            ) : (
              <span className="text-sm font-semibold text-stone-900">{ctx.propertyName}</span>
            )}
            <Badge tone="amber" title="Every person and record in this workspace is fictional.">Synthetic demo data</Badge>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-right leading-tight">
              <span className="block font-medium text-stone-900" data-testid="current-user">{ctx.userName}</span>
              <span className="block text-xs text-stone-500">{ROLE_LABEL[ctx.role]}{ctx.employmentType === "temp" ? " · temp" : ""}</span>
            </span>
            <form action={logoutAction}><button className={btn("secondary", "sm")}>Sign out</button></form>
          </div>
        </header>
        <SourcePanelProvider>
          <main className="mx-auto max-w-6xl px-5 py-7 lg:px-8">{children}</main>
        </SourcePanelProvider>
      </div>
    </div>
  );
}
