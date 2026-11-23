from typing import Literal

from app.schemas import Verdict


SCORECARD = {
    "argument_quality": {"pro": 4, "con": 2},
    "support_for_claims": {"pro": 5, "con": 3},
    "weighing_and_persuasiveness": {"pro": 3, "con": 1},
    "clarity_and_structure": {"pro": 4, "con": 4},
}


def scored_verdict(winner: Literal["pro", "con"], reason: str) -> Verdict:
    scores = SCORECARD if winner == "pro" else {
        category: {"pro": scores["con"], "con": scores["pro"]}
        for category, scores in SCORECARD.items()
    }
    return Verdict.model_validate({"scorecard": scores, "winner": winner, "reason": reason})
