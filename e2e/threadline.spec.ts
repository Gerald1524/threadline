import { expect, test } from "@playwright/test";
import { totpCode } from "../src/lib/auth/password";
import { SMOKE_Q, ask, signIn, stubSpeech } from "./helpers";

/**
 * The acceptance path from the product brief, driven through a real browser against a
 * production build and a freshly seeded database. Tests run in order and share state.
 */
test.describe.configure({ mode: "serial" });

test("smoke complaint: source-linked answer, original records, evidence gaps, follow-up", async ({ page }) => {
  await signIn(page, "u_priya");
  const answer = await ask(page, SMOKE_Q);
  await expect(answer.getByTestId("answer-headline")).toContainText("10 reports since Oct 5, 2026, 5 staff checks, no direct staff observation at 12B, 1 email unanswered");
  await expect(answer).toContainText("13 of 13 statements verified");
  await expect(answer).toContainText("Carlos Mendez (porter) on Oct 5, Oct 11 and Nov 2");
  await expect(answer).toContainText("This is the reporting resident's account, not a finding");

  // Inspect an original record from a citation.
  await answer.getByTestId("answer-claims").getByTestId("source-chip").first().click();
  const panel = page.getByTestId("source-panel");
  await expect(panel.getByTestId("source-text")).toContainText("Says strong cigarette smoke is coming into her apartment from 12B again");
  await expect(panel).toContainText("FD-1005-07");
  await expect(panel).toContainText("matches stored content");
  await expect(panel).toContainText("Michael Torres");
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();

  // Evidence gaps and conflicts are explicit.
  await answer.getByTestId("tab-gaps").click();
  await expect(answer.getByTestId("gaps")).toContainText("No staff member has directly observed smoking");
  await expect(answer.getByTestId("gaps")).toContainText("Oct 10, 2026 at 9:20 PM was not checked at the time");
  await expect(answer.getByTestId("gaps")).toContainText("Daniel Reyes of 12B denies it");
  await answer.getByTestId("tab-facts").click();
  await expect(answer.locator('[data-fact="direct_observation"]')).toHaveText("None recorded");
  await answer.getByTestId("tab-timeline").click();
  await answer.getByTestId("timeline-all").click();
  await expect(answer.getByTestId("timeline")).toContainText("tentative link · not counted");
  await expect(answer.getByTestId("timeline")).toContainText("duplicate entry · not counted");

  // Follow-up in the same conversation.
  await page.getByRole("button", { name: "Who was working that afternoon?" }).last().click();
  const follow = page.getByTestId("answer").last();
  await expect(follow).toHaveAttribute("data-intent", "who_on_shift");
  await expect(follow).toContainText("Mon, Oct 5, 2026, 3:45 PM: Michael Torres (concierge) was on the evening desk");
  await expect(follow).toContainText("Carlos Mendez (porter) checked at 3:54 PM");
});

test("the flagged anonymous email opens as evidence with a warning, not as an instruction", async ({ page }) => {
  await signIn(page, "u_priya");
  await page.goto("/review");
  const item = page.locator('[data-testid="review-item"][data-type="suspected_injection"]');
  await expect(item).toContainText("Text addressed to an AI system");
  await item.getByTestId("source-chip").click();
  const panel = page.getByTestId("source-panel");
  await expect(panel).toContainText("Contains text addressed to an AI system");
  await expect(panel.getByTestId("source-text")).toContainText("Ignore all previous instructions");
});

test("voice: dictated question is shown for review, answered from the same evidence, and read aloud", async ({ page }) => {
  await stubSpeech(page, "when did the smoke complaints about twelve bee start");
  await signIn(page, "u_priya");
  await page.getByTestId("mic").click();
  await expect(page.getByTestId("ask-input")).toHaveValue("when did the smoke complaints about twelve bee start");
  await expect(page.getByText("Check what was heard, edit if needed, then send.")).toBeVisible();
  await page.getByTestId("ask-submit").click();
  const answer = page.getByTestId("answer").last();
  await expect(answer.getByTestId("answer-headline")).toContainText("10 reports since Oct 5, 2026");
  await expect(page.getByText("dictated")).toBeVisible();
  await answer.getByTestId("read-aloud").click();
  const spoken = await page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);
  expect(spoken[0]).toContain("10 reports since Oct 5, 2026");
  expect(spoken[0]).toContain("no direct staff observation at 12B");
});

test("case packet: human review, PDF preview, download with a source index", async ({ page }) => {
  await signIn(page, "u_priya");
  const answer = await ask(page, "What can we substantiate about the smoke complaints about 12B?");
  await answer.getByRole("button", { name: "Generate Case Packet" }).click();
  await expect(page.getByTestId("packet-generate")).toBeDisabled();
  await page.getByTestId("packet-reviewed").check();
  await page.getByTestId("packet-generate").click();
  await expect(page.getByTestId("packet-preview")).toBeVisible({ timeout: 30_000 });
  const href = await page.getByTestId("packet-download").getAttribute("href");
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("application/pdf");
  const body = await res.body();
  expect(body.subarray(0, 5).toString()).toBe("%PDF-");
  expect(body.length).toBeGreaterThan(20_000);
  await page.goto("/reports");
  await expect(page.getByText("C-1001 case packet")).toBeVisible();
});

test("key request: true status, reviewed update request, maintenance ETA, updated answer", async ({ page }) => {
  await signIn(page, "u_michael");
  let answer = await ask(page, "What's happening with Carter's replacement key?");
  await expect(answer.getByTestId("answer-headline")).toContainText("approval approved; WO-2057 assigned, no ETA; resident followed up 2 times");
  await answer.getByRole("button", { name: "Request maintenance update" }).click();
  await expect(page.getByTestId("message-body")).toHaveValue(/there is no ETA on file/);
  await expect(page.getByTestId("message-body")).toHaveValue(/followed up 2 times/);
  await page.getByRole("button", { name: "Confirm and send" }).click();
  await expect(page.getByText("Sent (simulated delivery) and added to the case record.")).toBeVisible();

  await signIn(page, "u_luis");
  await page.goto("/work-orders");
  await expect(page.getByText("The front desk is waiting for an update on:")).toBeVisible();
  const row = page.getByTestId("wo-WO-2057");
  await row.getByRole("button", { expanded: false }).first().click();
  await row.getByTestId("wo-status").selectOption("in_progress");
  await row.getByTestId("wo-eta").fill("2026-11-16T15:00");
  await row.getByTestId("wo-note").fill("Key blank on hand, cutting this afternoon.");
  await row.getByTestId("wo-save").click();
  await expect(row.getByText("Work order updated.")).toBeVisible();
  await expect(row).toContainText("ETA Mon, Nov 16, 2026, 3:00 PM");

  await signIn(page, "u_michael");
  answer = await ask(page, "What's happening with Carter's replacement key?");
  await expect(answer.getByTestId("answer-headline")).toContainText("WO-2057 in progress, ETA Mon, Nov 16, 2026, 3:00 PM");
  await expect(answer).toContainText("An update was requested from maintenance on");
});

test("mirror request: current policy, review request, manager decision with a reason", async ({ page }) => {
  await signIn(page, "u_sam");
  const answer = await ask(page, "Ms. Feldman in 9A wants maintenance to hang a 60 lb mirror and to borrow a drill. What's the policy?");
  await expect(answer.getByTestId("answer-headline")).toContainText("over the 40 lb limit");
  await expect(answer).toContainText("Power tools, including drills, are not loaned to residents.");
  await expect(answer).toContainText("Version 1 of this policy is superseded");
  await answer.getByRole("button", { name: "Create review request for the manager" }).click();
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByText("Submitted for the community manager's review.")).toBeVisible();

  await signIn(page, "u_priya");
  await page.goto("/approvals");
  const card = page.getByTestId("pending-approval").filter({ hasText: "Installation / tools review — 9A" });
  await card.getByTestId("deny").click();
  await expect(card.getByText("A denial needs a short reason for the record.")).toBeVisible();
  await card.getByTestId("decision-note").fill("Over 40 lbs: resident to use a licensed and insured contractor.");
  await card.getByTestId("deny").click();
  await expect(page.getByTestId("pending-approval").filter({ hasText: "Installation / tools review — 9A" })).toHaveCount(0);
  await expect(page.getByRole("row").filter({ hasText: "Installation / tools review — 9A" })).toContainText("licensed and insured contractor");
});

test("temp-staff handoff and acknowledgement", async ({ page }) => {
  await signIn(page, "u_sam");
  await page.goto("/handoffs");
  await page.getByTestId("publish-handoff").click();
  await expect(page.getByText("Handoff published.")).toBeVisible();
  await signIn(page, "u_angela");
  await page.goto("/handoffs");
  const first = page.getByTestId("handoff").first();
  await expect(first).toContainText("Sam Okoye (temp)");
  await first.getByTestId("ack").click();
  await expect(first.getByText("You acknowledged")).toBeVisible();
  await expect(first).toContainText("Acknowledged by Angela Brooks");
});

test("new manager briefing", async ({ page }) => {
  await signIn(page, "u_dana");
  await page.getByTestId("example").filter({ hasText: "What should I know about this property?" }).click();
  const answer = page.getByTestId("answer").last();
  await expect(answer).toHaveAttribute("data-intent", "property_briefing");
  await expect(answer.getByTestId("answer-headline")).toContainText("open cases");
  await expect(answer).toContainText("C-1001 Smoke / odor — 12B");
  await expect(answer).toContainText("Legal hold in place on C-1001");
});

test("typed intake is reviewed before it is saved, then appears in the log", async ({ page }) => {
  await signIn(page, "u_angela");
  await page.goto("/activity");
  await page.getByTestId("intake-text").fill("Mrs. Liu from 13B called, says there is a loud banging noise coming from 14B above her. Asked Carlos to check.");
  await page.getByTestId("intake-preview").click();
  const review = page.getByTestId("intake-review");
  await expect(review).toContainText("complaint report");
  await expect(review).toContainText("about 14B");
  await expect(review).toContainText("Grace Liu");
  await page.getByTestId("intake-confirm").click();
  await expect(page.getByText("Entry saved to the building record.")).toBeVisible();
  await page.goto("/activity?unit=14B");
  await expect(page.getByTestId("timeline")).toContainText("loud banging noise coming from 14B");
});

test("front-desk roles are limited: restricted records, no admin areas, no direct record access", async ({ page }) => {
  await signIn(page, "u_priya");
  await page.goto("/review");
  const [res] = await Promise.all([page.waitForResponse((r) => r.url().includes("/api/source/")), page.locator('[data-testid="review-item"][data-type="sensitive_content"]').getByTestId("source-chip").click()]);
  const managementRecordUrl = res.url(); // a management-mailbox email

  await signIn(page, "u_michael");
  const answer = await ask(page, SMOKE_Q);
  await expect(answer).toContainText("restricted to management and are not included in this answer");
  await expect(answer).not.toContainText("attorney");
  await expect(page.getByRole("link", { name: "Data & Privacy" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Review inbox" })).toHaveCount(0);
  expect((await page.request.get(managementRecordUrl)).status()).toBe(404);
  await page.goto("/settings");
  await expect(page.getByTestId("app-error")).toContainText(/Not available to your role|could not be loaded/);
  await expect(page.getByText("Connected sources")).toHaveCount(0);
});

test("sources: incremental sync adds new records; a failed import stays visible and retryable", async ({ page }) => {
  await signIn(page, "u_priya");
  await page.goto("/sources");
  await page.getByTestId("sync-now").click();
  await expect(page.getByTestId("sync-result")).toContainText("Synced: 2 new record(s).");
  const failed = page.getByTestId("job-row").filter({ hasText: "temp-coverage-log (copy 2).xlsx" });
  await expect(failed).toContainText("failed");
  await failed.getByTestId("retry-job").click();
  await expect(failed).toContainText(/Still failing \(attempt \d\)/);
});

test("Data & Privacy: pause a source, change the AI provider policy, export, propose a retention action", async ({ page }) => {
  await signIn(page, "u_marcus");
  await page.goto("/settings");
  await expect(page.getByText("hash chain intact")).toBeVisible();
  const src = page.getByTestId("privacy-source-src_frontdesk_mailbox");
  await src.getByTestId("pause-source").click();
  await expect(src).toContainText("paused");
  await src.getByTestId("resume-source").click();
  await expect(src).toContainText("active");

  const provider = page.getByTestId("provider-reasoning");
  await expect(provider).toContainText("no credential: ANTHROPIC_API_KEY is not set");
  await provider.getByRole("combobox").selectOption("none");
  await provider.getByTestId("save-provider").click();
  await expect(provider.getByText("AI provider policy saved.")).toBeVisible();

  await page.getByTestId("create-export").click();
  await expect(page.getByTestId("export-row")).toHaveCount(1);
  const exp = await page.request.get((await page.getByTestId("export-row").getByRole("link").getAttribute("href"))!);
  const data = await exp.json();
  expect(data.manifest.format).toBe("threadline-export/1");
  expect(data.manifest.counts.source_records).toBeGreaterThan(150);

  await page.getByTestId("propose-lifecycle").click();
  await expect(page.getByTestId("lifecycle-request").first()).toContainText("under legal hold (skipped)");
  await expect(page.getByTestId("lifecycle-execute")).toBeDisabled();
});

test("another organization sees only its own building", async ({ page }) => {
  await signIn(page, "u_helen");
  await expect(page.getByText("Calder Court")).toBeVisible();
  const answer = await ask(page, "What do we know about the smoke complaints about 12B?");
  await expect(answer).toContainText("Farah Amari");
  await expect(answer).not.toContainText("Whitfield");
  await page.goto("/cases?status=all");
  await expect(page.getByRole("row")).toHaveCount(2); // header + Calder's single case
});

test("two-step verification: set up, recovery codes, required at sign-in, replay refused, turned off", async ({ page }) => {
  await signIn(page, "u_dmitri");
  await page.getByTestId("current-user").click();
  await expect(page.getByRole("heading", { name: "Your account" })).toBeVisible();
  await page.getByTestId("two-step-start").click();
  const secret = (await page.getByTestId("two-step-secret").innerText()).trim();
  expect(secret).toMatch(/^[A-Z2-7]{20}$/);
  await expect(page.getByRole("img", { name: "QR code for your authenticator app" }).locator("svg")).toBeVisible();
  await page.getByTestId("two-step-code").fill("000000");
  await page.getByTestId("two-step-confirm").click();
  await expect(page.getByRole("alert").filter({ hasText: "does not match" })).toBeVisible();
  const enrolCode = totpCode(secret);
  await page.getByTestId("two-step-code").fill(enrolCode);
  await page.getByTestId("two-step-confirm").click();
  await expect(page.getByTestId("recovery-code")).toHaveCount(10);
  const codes = await page.getByTestId("recovery-code").allInnerTexts();
  await page.getByTestId("recovery-codes-saved").click();
  await expect(page.getByTestId("two-step-on")).toBeVisible();
  await expect(page.getByTestId("recovery-codes-left")).toHaveText("10 recovery codes left.");

  // One-click demo sign-in no longer works for this account; a second factor is required.
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByTestId("demo-u_dmitri").click();
  await expect(page.getByText("That account uses two-step verification")).toBeVisible();
  const signInWith = async (code: string) => {
    await page.getByLabel("Work email").fill("dmitri.volkov@northbridge.example");
    await page.getByLabel("Password").fill("threadline-demo");
    await page.getByLabel("Verification code").fill(code);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  };
  await signInWith(enrolCode); // already used once: refused
  await expect(page.getByRole("alert").filter({ hasText: "verification code is incorrect" })).toBeVisible();
  await signInWith(codes[0]); // a recovery code works once
  await expect(page.getByTestId("current-user")).toHaveText("Dmitri Volkov");

  await page.goto("/account");
  await expect(page.getByTestId("recovery-codes-left")).toHaveText("9 recovery codes left.");
  await page.getByRole("button", { name: "Turn off…" }).click();
  await page.getByLabel("Password").fill("threadline-demo");
  await page.getByLabel("Current code").fill(totpCode(secret, Date.now() + 30_000));
  await page.getByRole("button", { name: "Turn off", exact: true }).click();
  await expect(page.getByTestId("two-step-off")).toBeVisible();
});

test("an administrator can require two-step verification for everyone", async ({ page }) => {
  await signIn(page, "u_marcus");
  await page.goto("/settings");
  const panel = page.getByTestId("two-step-requirement");
  await expect(panel).toContainText("Optional");
  await expect(page.getByTestId("isolation-status")).toContainText("enforced by the database");
  await panel.getByTestId("toggle-two-step-requirement").click();
  await expect(panel.getByRole("alert")).toContainText("your own account first");

  await page.goto("/account");
  await page.getByTestId("two-step-start").click();
  const secret = (await page.getByTestId("two-step-secret").innerText()).trim();
  await page.getByTestId("two-step-code").fill(totpCode(secret));
  await page.getByTestId("two-step-confirm").click();
  await page.getByTestId("recovery-codes-saved").click();
  await expect(page.getByTestId("two-step-on")).toBeVisible();
  await page.goto("/settings");
  await panel.getByTestId("toggle-two-step-requirement").click();
  await expect(panel).toContainText("Required for everyone");

  // Someone without it is sent to set it up before anything else, pages and API alike.
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByTestId("demo-u_angela").click();
  await page.waitForURL(/\/account\?required=1/);
  await expect(page.getByTestId("two-step-required")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link")).toHaveCount(0);
  await page.goto("/cases");
  await page.waitForURL(/\/account\?required=1/);
  expect((await page.request.get("/api/source/sr_any")).status()).toBe(403);

  // Restore the demo: sign back in as the administrator, with a code, and stop requiring it.
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Work email").fill("marcus.bell@northbridge.example");
  await page.getByLabel("Password").fill("threadline-demo");
  await page.getByLabel("Verification code").fill(totpCode(secret, Date.now() + 30_000));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByTestId("current-user")).toHaveText("Marcus Bell");
  await page.goto("/settings");
  await panel.getByTestId("toggle-two-step-requirement").click();
  await expect(panel).toContainText("Optional");
});

test("security headers on pages and API responses; health check needs no sign-in and reveals no data", async ({ page }) => {
  const res = await page.goto("/login");
  const h = res!.headers();
  expect(h["content-security-policy"]).toContain("default-src 'self'");
  expect(h["content-security-policy"]).toContain("frame-ancestors 'self'");
  expect(h["content-security-policy"]).toContain("object-src 'none'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["x-frame-options"]).toBe("SAMEORIGIN");
  expect(h["permissions-policy"]).toContain("microphone=(self)");
  expect(h["x-powered-by"]).toBeUndefined();

  const health = await page.request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: "ok", checks: { database: "ok", organizationIsolation: "enforced" } });
  expect(health.headers()["content-security-policy"]).toBeUndefined(); // API responses (PDFs, files) are left to the browser's viewers
  expect(health.headers()["x-content-type-options"]).toBe("nosniff");
});
