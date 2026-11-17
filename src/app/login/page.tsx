import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { demoLoginAction } from "@/app/actions";
import { ROLE_LABEL, type Role } from "@/lib/access";
import { getContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { memberships, organizations, properties, users } from "@/lib/db/schema";
import { Badge, Card } from "@/components/ui";
import { LoginForm } from "./login-form";

const SEE: Record<Role, string> = {
  community_manager: "Everything at the property, approvals, review inbox, case packets",
  regional_admin: "All properties, plus Data & Privacy administration",
  concierge: "Desk log, cases, work orders, handoffs — no management mail",
  temp_concierge: "Same as concierge, without resident contact details",
  porter: "Work orders, checks, activity — can update work orders",
  superintendent: "Operations view, can create and update work orders",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ twostep?: string }> }) {
  if (await getContext()) redirect("/");
  const twoStep = (await searchParams).twostep === "1";
  const demo = process.env.THREADLINE_DEMO_LOGIN !== "0";
  const db = await getDb();
  const rows = demo
    ? await db.select({ u: users, m: memberships, org: organizations.name, prop: properties.name }).from(users).innerJoin(memberships, eq(memberships.userId, users.id)).innerJoin(organizations, eq(organizations.id, users.orgId)).leftJoin(properties, eq(properties.id, memberships.propertyId))
    : [];
  const order: Role[] = ["community_manager", "regional_admin", "concierge", "temp_concierge", "superintendent", "porter"];
  rows.sort((a, b) => a.org.localeCompare(b.org) * -1 || order.indexOf(a.m.role as Role) - order.indexOf(b.m.role as Role));
  return (
    <main className="mx-auto grid min-h-screen max-w-6xl items-start gap-10 px-6 py-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
      <div className="lg:sticky lg:top-14">
        <div className="flex items-center gap-2.5 text-brand-800">
          <Logo />
          <span className="text-lg font-semibold tracking-tight">Threadline</span>
        </div>
        <h1 className="mt-8 text-3xl font-semibold leading-tight tracking-tight text-stone-900">Ask your building what happened — and see the records behind the answer.</h1>
        <p className="mt-4 text-[15px] leading-relaxed text-stone-600">An evidence-first record of complaints, requests, inspections, approvals and handoffs. Every statement links to the original log entry, email or work order.</p>
        <Card className="mt-8 p-5">
          <h2 className="text-sm font-semibold text-stone-900">Sign in</h2>
          {twoStep ? <p role="status" className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">That account uses two-step verification. Sign in with its email, password and code.</p> : null}
          <LoginForm />
        </Card>
        <p className="mt-4 text-xs leading-relaxed text-stone-500">Threadline records who received, checked and answered an operational matter. It is not an employee-monitoring or performance tool.</p>
      </div>
      {demo ? (
        <Card className="p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-stone-900">Demo accounts</h2>
            <Badge tone="amber">Synthetic data only</Badge>
          </div>
          <p className="mt-1 text-xs text-stone-500">Every person and record is fictional. Choose a role to see what that role can see and do. Password for all accounts: <code className="rounded bg-stone-100 px-1">threadline-demo</code></p>
          <ul className="mt-4 divide-y divide-stone-100">
            {rows.map(({ u, m, org, prop }) => (
              <li key={u.id}>
                <form action={demoLoginAction}>
                  <input type="hidden" name="userId" value={u.id} />
                  <button className="group flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-stone-50" data-testid={`demo-${u.id}`}>
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-semibold text-brand-800">{u.fullName.split(" ").map((x) => x[0]).join("")}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-medium text-stone-900">
                        {u.fullName}
                        <Badge tone="brand">{ROLE_LABEL[m.role as Role]}</Badge>
                        {u.employmentType === "temp" ? <Badge tone="violet">temp</Badge> : null}
                      </span>
                      <span className="block truncate text-xs text-stone-500">{prop ?? `All ${org} properties`} · {SEE[m.role as Role]}</span>
                    </span>
                    <span className="text-xs font-medium text-brand-700 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">Sign in →</span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
          {!rows.length ? <p className="mt-4 text-sm text-stone-600">The database is empty. Run <code className="rounded bg-stone-100 px-1">npm run seed</code> and reload.</p> : null}
        </Card>
      ) : null}
    </main>
  );
}

function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden>
      <rect width="26" height="26" rx="7" fill="currentColor" />
      <path d="M7 8h12M7 13h8M7 18h10" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      <circle cx="19" cy="13" r="1.6" fill="#5eead4" />
    </svg>
  );
}
