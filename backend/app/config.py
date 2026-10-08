import os
from dataclasses import dataclass
from urllib.parse import urlparse

from dotenv import load_dotenv


load_dotenv()


def required_environment_variable(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def with_psycopg_driver(database_url: str) -> str:
    # append driver name (psycopg) to URL protocol if not already exists
    if database_url.startswith("postgresql://"):
        return database_url.replace("postgresql://", "postgresql+psycopg://", 1)
    return database_url


# Free on OpenRouter and supports response schemas (needed by the judge).
DEFAULT_OPENROUTER_MODEL = "nvidia/nemotron-3-super-120b-a12b:free"


@dataclass(frozen=True)
class Settings:
    database_url: str
    test_database_url: str | None
    google_client_id: str
    google_client_secret: str
    session_secret: str
    frontend_url: str
    secure_cookies: bool
    # "development" lets startup reset an unrecoverable local database.
    app_env: str
    inference_base_url: str
    inference_api_key: str
    # Judge model ID as the provider names it; argument models come from the database.
    inference_judge_model: str

    @property
    def inference_is_openrouter(self) -> bool:
        """Whether to send OpenRouter-only request options (other providers may reject them)."""
        return urlparse(self.inference_base_url).hostname == "openrouter.ai"

    @classmethod
    def from_environment(cls) -> Settings:
        test_database_url = os.getenv("TEST_POSTGRES_URL")

        return cls(
            database_url=with_psycopg_driver(required_environment_variable("POSTGRES_URL")),
            test_database_url=with_psycopg_driver(test_database_url) if test_database_url else None,
            google_client_id=required_environment_variable("GOOGLE_CLIENT_ID"),
            google_client_secret=required_environment_variable("GOOGLE_CLIENT_SECRET"),
            session_secret=required_environment_variable("SESSION_SECRET"),
            frontend_url=os.getenv("FRONTEND_URL", "http://localhost:3000"),
            secure_cookies=os.getenv("SECURE_COOKIES", "false").lower() == "true",
            app_env=os.getenv("APP_ENV", "production"),
            inference_base_url=required_environment_variable("INFERENCE_BASE_URL"),
            inference_api_key=required_environment_variable("INFERENCE_API_KEY"),
            inference_judge_model=os.getenv("INFERENCE_JUDGE_MODEL", DEFAULT_OPENROUTER_MODEL),
        )


settings = Settings.from_environment()
