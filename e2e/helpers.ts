import { expect, type Page } from "@playwright/test";

export const SMOKE_Q = "The resident emailed again about cigarette smoke near 12B. When did this start? Who investigated? Did we reply? What can we actually substantiate?";

export async function signIn(page: Page, userId: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByTestId(`demo-${userId}`).click();
  await page.waitForURL("/");
  await expect(page.getByRole("heading", { name: "Ask your building" })).toBeVisible();
}

/** Ask a question and return the locator of the newest answer card. */
export async function ask(page: Page, question: string) {
  const before = await page.getByTestId("answer").count();
  await page.getByTestId("ask-input").fill(question);
  await page.getByTestId("ask-submit").click();
  await expect(page.getByTestId("answer")).toHaveCount(before + 1);
  return page.getByTestId("answer").last();
}

/** Browser speech APIs are replaced with deterministic stand-ins: no audio hardware exists in CI. */
export async function stubSpeech(page: Page, transcript: string) {
  await page.addInitScript((text) => {
    class FakeRecognition {
      lang = ""; interimResults = false; continuous = false;
      onresult: ((e: unknown) => void) | null = null; onerror: ((e: unknown) => void) | null = null; onend: (() => void) | null = null;
      start() {
        setTimeout(() => {
          const result = Object.assign([{ transcript: text }], { isFinal: true });
          this.onresult?.({ results: [result] });
          this.onend?.();
        }, 150);
      }
      stop() { this.onend?.(); }
    }
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeRecognition;
    (window as unknown as Record<string, unknown>).SpeechRecognition = FakeRecognition;
    const spoken: string[] = [];
    (window as unknown as Record<string, unknown>).__spoken = spoken;
    window.speechSynthesis.speak = (u: SpeechSynthesisUtterance) => { spoken.push(u.text); };
    window.speechSynthesis.cancel = () => {};
  }, transcript);
}
