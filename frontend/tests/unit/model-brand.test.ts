import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
// @ts-expect-error Node executes TypeScript directly.
import { modelBrand } from "../../app/lib/model-brand.ts";
// @ts-expect-error Node executes TypeScript directly.
import { parseArenas } from "../../app/lib/protocol.ts";
const arena = { id: "11111111-1111-4111-8111-111111111111", display_name: "Model", kind: "provided" as const };

test("author logos are independent of routed or first-party inference", () => {
  for (const [provider, slug, logo] of [
    ["openai", "gpt-4.1", "openai"], ["anthropic", "claude-sonnet", "anthropic"],
    ["google", "gemini-2.5-pro", "gemini"], ["x-ai", "grok-3", "grok"],
    ["nvidia", "nemotron", "nvidia"], ["cohere", "command", "cohere"],
    ["deepseek", "deepseek-chat", "deepseek"], ["meta-llama", "llama", "meta"],
    ["mistralai", "mistral-small", "mistral"], ["qwen", "qwen3", "qwen"],
    ["google", "gemma-3", "google"],
  ]) {
    for (const identity of [{ provider_slug: provider, model_slug: slug }, { provider_slug: "openrouter", model_slug: `${provider}/${slug}` }]) {
      const brand = modelBrand({ ...arena, ...identity });
      assert.equal(brand?.logo, logo);
      const file = new URL(`../../public/model-logos/${brand!.logo}.svg`, import.meta.url);
      assert.ok(existsSync(file));
      assert.doesNotMatch(readFileSync(file, "utf8"), /<script|<foreignObject|https?:\/\/(?!www\.w3\.org)/i);
    }
  }
});
test("unknown authors and special queues never inherit a routing logo", () => {
  for (const identity of [{ provider_slug: "openrouter", model_slug: "unknown/model" }, { provider_slug: "unknown", model_slug: "model" }, { provider_slug: "openrouter" }]) assert.equal(modelBrand({ ...arena, ...identity }), null);
  assert.equal(modelBrand({ ...arena, id: "quick", provider_slug: "openai" }), null);
  assert.equal(modelBrand({ ...arena, kind: "byom", provider_slug: "openai" }), null);
  assert.equal(modelBrand({ ...arena, display_name: "NVIDIA: Nemotron" })?.logo, "nvidia");
  assert.equal(modelBrand({ ...arena, display_name: "Some GPT competitor" }), null);
});
test("arena identity remains compatible with older servers and rejects malformed metadata", () => {
  assert.deepEqual(parseArenas([arena]), [arena]);
  for (const identity of [{ provider_slug: null, model_slug: null }, { provider_slug: "openrouter", model_slug: "openai/gpt-4.1" }]) assert.deepEqual(parseArenas([{ ...arena, ...identity }]), [{ ...arena, ...identity }]);
  for (const identity of [{ provider_slug: 5 }, { model_slug: {} }]) assert.throws(() => parseArenas([{ ...arena, ...identity }]));
});
