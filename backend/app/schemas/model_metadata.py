from pydantic import BaseModel, ConfigDict


class ModelProviderMetadata(BaseModel):
    """Provider-specific metadata; validate before storing in models.provider_metadata."""

    model_config = ConfigDict(extra="allow")
