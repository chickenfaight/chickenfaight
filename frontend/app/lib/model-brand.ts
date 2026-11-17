import type { Arena } from "./protocol";

type Brand = { name: string; logo: string };
const brands: Record<string, Brand> = {
  openai: { name: "OpenAI", logo: "openai" },
  anthropic: { name: "Anthropic", logo: "anthropic" },
  google: { name: "Google", logo: "google" },
  gemini: { name: "Google Gemini", logo: "gemini" },
  "x-ai": { name: "xAI", logo: "grok" },
  xai: { name: "xAI", logo: "grok" },
  grok: { name: "xAI", logo: "grok" },
  nvidia: { name: "NVIDIA", logo: "nvidia" },
  cohere: { name: "Cohere", logo: "cohere" },
  deepseek: { name: "DeepSeek", logo: "deepseek" },
  "meta-llama": { name: "Meta", logo: "meta" },
  meta: { name: "Meta", logo: "meta" },
  mistralai: { name: "Mistral", logo: "mistral" },
  mistral: { name: "Mistral", logo: "mistral" },
  qwen: { name: "Qwen", logo: "qwen" },
};

// Identity is separate from transport: OpenRouter's namespace identifies the author,
// while a direct provider can serve unqualified IDs (e.g. anthropic + claude-sonnet).
export function modelBrand(arena: Arena): Brand | null {
  if (arena.kind === "byom" || arena.id === "quick") return null;
  const provider = arena.provider_slug?.toLowerCase();
  const model = arena.model_slug?.toLowerCase();
  const namespace = model?.includes("/") ? model.split("/")[0] : undefined;
  if (namespace === "google" && model?.split("/")[1]?.startsWith("gemini")) return brands.gemini;
  if (namespace) return brands[namespace] ?? null;
  if (provider === "google" && model?.startsWith("gemini")) return brands.gemini;
  if (provider && provider !== "openrouter") return brands[provider] ?? null;
  // Older servers have no identity metadata. Only match an explicit author prefix.
  if (!provider && !model && arena.display_name.includes(": ")) {
    return brands[arena.display_name.split(": ")[0].toLowerCase()] ?? null;
  }
  return null;
}
