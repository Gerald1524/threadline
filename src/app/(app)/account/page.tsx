import { ROLE_LABEL } from "@/lib/access";
import { requireContext } from "@/lib/auth/session";
import { getAccount } from "@/lib/services/account";
import { TwoStepPanel } from "@/components/account-forms";
import { Card, CardHeader, PageHeader } from "@/components/ui";

export default async function AccountPage() {
  const ctx = await requireContext();
  const a = await getAccount(ctx);
  return (
    <>
      <PageHeader title="Your account" lead="Your sign-in details. Changes to two-step verification are recorded in the audit log." />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Profile" />
          <dl className="grid gap-3 px-5 py-4 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-stone-500">Name</dt><dd>{a.fullName}</dd></div>
            <div><dt className="text-xs text-stone-500">Work email</dt><dd>{a.email}</dd></div>
            <div><dt className="text-xs text-stone-500">Job title</dt><dd>{a.jobTitle}</dd></div>
            <div><dt className="text-xs text-stone-500">Role at {ctx.propertyName}</dt><dd>{ROLE_LABEL[ctx.role]}</dd></div>
          </dl>
        </Card>
        <Card>
          <CardHeader title="Two-step verification" hint="After your password, sign-in also asks for a six-digit code from an authenticator app on your phone." />
          <TwoStepPanel enabled={a.twoStepEnabled} />
        </Card>
      </div>
    </>
  );
}
