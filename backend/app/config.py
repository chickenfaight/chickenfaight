import os
from dataclasses import dataclass

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
        )


settings = Settings.from_environment()
