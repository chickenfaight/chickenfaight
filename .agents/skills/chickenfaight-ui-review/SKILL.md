---
name: chickenfaight-ui-review
description: Review a Chicken fAIght screen for usability, visual consistency, accessibility, and live match states. Use for UI audits or a final frontend quality review.
---

Read `AGENTS.md`, `frontend/FRONTEND.md`, and `TESTING.md`. They own the product, visual system, and safe browser harness; do not duplicate them in new design documents.

Review the requested route and its shared components. If no target was given, use the changed frontend screens. Use web-design-guidelines for accessibility and interaction checks, and Impeccable critique/polish references for hierarchy and clarity, loading only relevant references. Preserve the existing visual identity and shared components.

Inspect the rendered page at desktop widths and with keyboard navigation. Check primary action hierarchy, focus and dismissal, labels and errors, long model names/text, loading/empty/failure states, and reduced motion. For the arena inspect composition, streaming, waiting, judging, and results; model output stays plain text and private prompts stay private. Do not announce each streamed token to screen readers.

Use the isolated browser harness for screenshots and automated checks. Never run browser tests alongside backend pytest. Review screenshot changes rather than accepting new baselines solely to make tests pass. Automated accessibility checks supplement keyboard and screen-reader review.

Report prioritized actionable findings with file/line, user impact, and a concrete fix. Include screenshot artifact paths, checks performed, and untested states. For a review-only request, report findings before changing behavior. For an implementation request, fix issues within scope and verify the affected states.
