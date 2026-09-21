import os
from dataclasses import dataclass

from dotenv import load_dotenv


load_dotenv()


def required_environment_variable(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


@dataclass(frozen=True)
class Settings:
    database_url: str
    google_client_id: str
    google_client_secret: str
    session_secret: str
    frontend_url: str
    secure_cookies: bool

    @classmethod
    def from_environment(cls) -> Settings:
        database_url = required_environment_variable("POSTGRES_URL")

        # append driver name (psycopg) to URL protocol if not already exists
        if database_url.startswith("postgresql://"):
            database_url = database_url.replace(
                "postgresql://",
                "postgresql+psycopg://",
                1,
            )

        return cls(
            database_url=database_url,
            google_client_id=required_environment_variable("GOOGLE_CLIENT_ID"),
            google_client_secret=required_environment_variable("GOOGLE_CLIENT_SECRET"),
            session_secret=required_environment_variable("SESSION_SECRET"),
            frontend_url=os.getenv("FRONTEND_URL", "http://localhost:3000"),
            secure_cookies=os.getenv("SECURE_COOKIES", "false").lower() == "true",
        )


settings = Settings.from_environment()
