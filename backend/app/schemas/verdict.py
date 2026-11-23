"""Structured verdict returned by the judge and scores shared with players."""

from typing import Annotated, Literal, Self

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, model_validator

from app.models.match import ScoreCategory


type VerdictSide = Literal["pro", "con"]


def _clean_judge_text(value: object) -> object:
    if isinstance(value, str):
        return value.replace("\x00", "").strip()
    return value


JudgeText = Annotated[str, BeforeValidator(_clean_judge_text)]


class CategoryScore(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pro: int = Field(strict=True, ge=0, le=5)
    con: int = Field(strict=True, ge=0, le=5)


class Scorecard(BaseModel):
    model_config = ConfigDict(extra="forbid")

    argument_quality: CategoryScore
    support_for_claims: CategoryScore
    weighing_and_persuasiveness: CategoryScore
    clarity_and_structure: CategoryScore

    def total(self, side: VerdictSide) -> int:
        return sum(scores[side] for scores in self.model_dump().values())


class Verdict(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scorecard: Scorecard
    winner: VerdictSide
    reason: JudgeText = Field(min_length=1, max_length=1000)

    @model_validator(mode="after")
    def winner_matches_scores(self) -> Self:
        opponent = "con" if self.winner == "pro" else "pro"
        if self.scorecard.total(self.winner) < self.scorecard.total(opponent):
            raise ValueError("The winning side must have at least as many points as the other side")
        return self


class JudgeHighlight(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category: ScoreCategory
    explanation: JudgeText = Field(min_length=1, max_length=400)


class JudgeResponse(BaseModel):
    """Provider output, converted to the public verdict after parsing."""

    model_config = ConfigDict(extra="forbid")

    scorecard: Scorecard
    winner: VerdictSide
    highlights: list[JudgeHighlight] = Field(min_length=1, max_length=2)

    def to_verdict(self) -> Verdict:
        if len({highlight.category for highlight in self.highlights}) != len(self.highlights):
            raise ValueError("Judge highlights must cover distinct categories")

        paragraphs = []
        for highlight in self.highlights:
            category = highlight.category.value
            label = category.replace("_", " ").capitalize()
            scores = getattr(self.scorecard, category)
            paragraphs.append(f"{label} (Pro {scores.pro}/5 · Con {scores.con}/5)\n{highlight.explanation}")
        return Verdict(scorecard=self.scorecard, winner=self.winner, reason="\n\n".join(paragraphs))
