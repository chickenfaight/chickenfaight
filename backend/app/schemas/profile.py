from pydantic import BaseModel


class CategoryScoreAverages(BaseModel):
    argument_quality: float
    support_for_claims: float
    weighing_and_persuasiveness: float
    clarity_and_structure: float


class ScoreAverages(BaseModel):
    match_count: int
    total: float
    categories: CategoryScoreAverages
