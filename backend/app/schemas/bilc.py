"""BILC REST bodies and WebSocket payloads (PROTOCOL.md, "REST — BILC" and "WebSocket — BILC")."""

import json
import unicodedata
from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, field_validator

# BACKEND.md, "JSONB conventions": client-supplied model metadata is capped at 4 KB.
MAX_MODEL_METADATA_BYTES = 4096


def visible_text(value: str) -> str:
    """Trimmed text without control or invisible formatting characters, which could spoof or hide names."""
    value = value.strip()
    if not value or any(unicodedata.category(ch) in ("Cc", "Cf") for ch in value):
        raise ValueError("must be visible text")
    return value


VisibleText = Annotated[str, AfterValidator(visible_text)]


class PairingCodeRead(BaseModel):
    code: str
    expires_at: datetime


class BilcRegister(BaseModel):
    pairing_code: str = Field(max_length=16)
    device_name: VisibleText = Field(max_length=64)
    platform: VisibleText = Field(max_length=32)
    client_version: VisibleText = Field(max_length=32)

    @field_validator("pairing_code")
    @classmethod
    def normalize_code(cls, code: str) -> str:
        # Typed by hand, so accept lowercase and the grouping the web app shows (ABCD-EFGH).
        return code.strip().replace("-", "").replace(" ", "").upper()


class BilcRegistered(BaseModel):
    bilc_id: UUID
    refresh_token: str


class BilcTokenRequest(BaseModel):
    bilc_id: UUID
    refresh_token: str = Field(max_length=128)


class BilcTokens(BaseModel):
    access_token: str
    expires_at: datetime
    refresh_token: str


class BilcDeviceRead(BaseModel):
    id: UUID
    name: str
    platform: str
    client_version: str
    model_name: str | None
    # Parameter-count class from the model's reported size (PROTOCOL.md, "BYOM arena"); null until it connects.
    size_class: Literal["small", "medium", "large"] | None
    online: bool
    status: Literal["offline", "idle", "busy"]
    last_seen_at: datetime | None
    created_at: datetime


class HelloModel(BaseModel):
    name: VisibleText = Field(max_length=128)
    context_length: int | None = Field(default=None, ge=1)
    metadata: dict[str, Any] = {}


class Hello(BaseModel):
    """First frame on the BILC socket. Unknown fields are ignored, per PROTOCOL.md's conventions."""
    model_config = ConfigDict(extra="ignore")

    protocol_version: int
    client_version: VisibleText = Field(max_length=32)
    platform: VisibleText = Field(max_length=32)
    model: HelloModel

    @field_validator("model")
    @classmethod
    def cap_model_size(cls, model: HelloModel) -> HelloModel:
        if len(json.dumps(model.model_dump()).encode()) > MAX_MODEL_METADATA_BYTES:
            raise ValueError("model information is over 4 KB")
        return model
