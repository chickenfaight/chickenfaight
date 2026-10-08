import uuid
from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Numeric, String, UniqueConstraint, Uuid, func, text, Enum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class InferenceAdapter(StrEnum):
    OPENAI_COMPATIBLE = "openai_compatible"


class Model(Base):
    __tablename__ = "models"
    __table_args__ = (
        UniqueConstraint("provider_id", "api_model_id", name="uq_models_provider_id_api_model_id"),
        CheckConstraint("input_cost >= 0", name="input_cost_nonnegative"),
        CheckConstraint("output_cost >= 0", name="output_cost_nonnegative"),
        CheckConstraint("cached_input_cost >= 0", name="cached_input_cost_nonnegative"),
        CheckConstraint("context_window > 0", name="context_window_positive"),
        CheckConstraint("max_output_tokens > 0", name="max_output_tokens_positive"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)

    provider_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("providers.id"),
        nullable=False,
        index=True,
    )

    api_model_id: Mapped[str] = mapped_column(String(255)) # used for API calls ex. openai/gpt-6-astra
    display_name: Mapped[str] = mapped_column(String(255)) # ex. GPT-6 Astra

    # USD per million tokens; None means unknown, Decimal("0") means free
    input_cost: Mapped[Decimal | None] = mapped_column(Numeric(20, 10))
    output_cost: Mapped[Decimal | None] = mapped_column(Numeric(20, 10))
    cached_input_cost: Mapped[Decimal | None] = mapped_column(Numeric(20, 10))
    pricing_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    context_window: Mapped[int | None] = mapped_column()
    max_output_tokens: Mapped[int | None] = mapped_column()

    is_active: Mapped[bool] = mapped_column(default=True, server_default=text("true"))
    provider_metadata: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb"),
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class Provider(Base):
    __tablename__ = "providers"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)

    # internal identifier - use to reference API keys from env e.g. openrouter, openai (first party)
    slug: Mapped[str] = mapped_column(String(255), unique=True)
    display_name: Mapped[str] = mapped_column(String(255))
    base_url: Mapped[str] = mapped_column(String(255))
    adapter: Mapped[InferenceAdapter] = mapped_column(
        Enum(
            InferenceAdapter,
            values_callable=lambda enum: [member.value for member in enum],
            native_enum=False,
            create_constraint=True,
            validate_strings=True,
            name="inference_adapter",
        ),
    )

    is_active: Mapped[bool] = mapped_column(server_default=text("true"))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )
