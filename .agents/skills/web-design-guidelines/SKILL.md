---
name: web-design-guidelines
description: Review UI code for Web Interface Guidelines compliance. Use when asked to "review my UI", "check accessibility", "audit design", "review UX", or "check my site against best practices".
metadata:
  author: vercel
  version: "1.0.0"
  argument-hint: <file-or-pattern>
---

# Web Interface Guidelines

Review files for compliance with Web Interface Guidelines.

## How It Works

1. Identify the files to review from the request. If the scope is unclear, ask for a file or pattern.
2. Open the upstream guidelines with Codex's web tool before each review.
3. Read the specified files, apply the rules from the selected source, and report findings in the format specified by the guidelines.

## Guidelines Source

Open this URL directly with the available web tool:

```
https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md
```

Use the live document for the rules and output format. If the web tool is unavailable or cannot retrieve the complete rules, read [the pinned fallback](references/command.md) in full and mention in the review that you used it. Load the fallback only when needed. If neither source is readable, report that the compliance review is incomplete.
