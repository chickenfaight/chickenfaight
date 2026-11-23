import type { JudgeCategory } from "./protocol";

export const JUDGE_RUBRIC = {
  argument_quality: {
    label: "Argument quality",
    description: "Checks whether each main reason supports the position and whether the reasoning has gaps or contradictions.",
  },
  support_for_claims: {
    label: "Support for claims",
    description: "Looks for concrete examples, stated assumptions, and qualified claims. The judge flags key claims with little support in the opening. Citations alone earn no credit, and external facts remain unverified.",
  },
  weighing_and_persuasiveness: {
    label: "Weighing and persuasiveness",
    description: "Looks at how each opening compares benefits, harms, and tradeoffs by scale, likelihood, and who is affected.",
  },
  clarity_and_structure: {
    label: "Clarity and structure",
    description: "Checks whether the position, main points, and connections are easy to follow. Length, polish, and confidence alone earn no credit.",
  },
} satisfies Record<JudgeCategory, { label: string; description: string }>;
