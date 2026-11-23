"""Structured verdict returned by the judge and scores shared with players."""

from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


type VerdictSide = Literal["pro", "con"]


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
    reason: str = Field(min_length=1, max_length=1000)

    @field_validator("reason", mode="before")
    @classmethod
    def clean_reason(cls, value: object) -> object:
        if isinstance(value, str):
            return value.replace("\x00", "").strip()
        return value

    @model_validator(mode="after")
    def winner_matches_scores(self) -> Self:
        opponent = "con" if self.winner == "pro" else "pro"
        if self.scorecard.total(self.winner) < self.scorecard.total(opponent):
            raise ValueError("The winning side must have at least as many points as the other side")
        return self
