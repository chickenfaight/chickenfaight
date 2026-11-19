# Vendored design skills

- Impeccable: https://github.com/pbakaus/impeccable/tree/d41d9860b0094dcb68030657da63461212835aaa/.agents/skills/impeccable (MIT). Local integration section in SKILL.md routes product/design context to existing repository docs.
- Web Design Guidelines: https://github.com/vercel-labs/agent-skills/tree/1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62/skills/web-design-guidelines. Fetches live rules through the web tool and falls back to `web-design-guidelines/references/command.md` (MIT), pinned to [the upstream rules revision](https://github.com/vercel-labs/web-interface-guidelines/blob/4ecfb9fb8d1d3b7009674869b3aaee2f904042e1/command.md).
- chickenfaight-ui-review: maintained in this repository.

Review upstream diffs before replacing vendored files; preserve the local integration section. Impeccable's launcher downloads a platform engine on first use and verifies it against the bundled checksums. Generated caches and engines are not committed. Emil's animation skill remains an optional future addition to avoid overlapping design instructions.
