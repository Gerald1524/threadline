import { requireContext } from "@/lib/auth/session";
import { voiceConfig } from "@/lib/ai/voice";
import { authorizeProvider } from "@/lib/ai/provider";
import { AskWorkspace } from "@/components/ask-workspace";

const SMOKE = "The resident emailed again about cigarette smoke near 12B. When did this start? Who investigated? Did we reply? What can we actually substantiate?";
const EXAMPLES: Record<string, string[]> = {
  community_manager: [SMOKE, "What should I know about this property?", "What's the full history of 12B?", "What's happening with Carter's replacement key?"],
  regional_admin: [SMOKE, "What should I know about this property?", "What do we know about the noise complaints from 5E about 6E?", "What's the full history of 12B?"],
  concierge: ["What's happening with Carter's replacement key?", "Ms. Feldman in 9A wants maintenance to hang a 60 lb mirror and to borrow a drill. What's the policy?", "What do we know about the smoke complaints about 12B?", "What should I know about this property?"],
  temp_concierge: ["What's happening with Carter's replacement key?", "Ms. Feldman in 9A wants maintenance to hang a 60 lb mirror and to borrow a drill. What's the policy?", "What do we know about the noise complaints from 5E about 6E?", "Can I let a locked-out resident in? What is the policy?"],
  porter: ["What's happening with Carter's replacement key?", "What do we know about the smoke complaints about 12B?", "What's the status of WO-2041?", "What do we know about the noise complaints from 5E about 6E?"],
  superintendent: ["What should I know about this property?", "What's happening with Carter's replacement key?", "What do we know about the smoke complaints about 12B?", "What's the full history of 4A?"],
};

export default async function AskPage() {
  const ctx = await requireContext("ask");
  const voice = await voiceConfig(ctx);
  const model = await authorizeProvider(ctx, "reasoning", "anthropic", []);
  return <AskWorkspace userFirstName={ctx.userName.split(" ")[0]} propertyName={ctx.propertyName} examples={EXAMPLES[ctx.role] ?? EXAMPLES.concierge} voice={voice} modelConfigured={model.allowed} />;
}
