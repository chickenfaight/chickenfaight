"""Topic lists: the pipe-delimited format shared by the CLI importer (`app/db/seed.py`) and the
admin upload route, and adding parsed topics without duplicating existing ones."""

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.topic import Topic
from app.repositories.topic import TopicRepository
from app.schemas import AdminTopic, AdminTopicsPage, TopicUploadResult
from app.services.exceptions import TopicsInvalidError

ParsedTopic = tuple[str, str, str, str]

# One upload's limits (PROTOCOL.md). The example file has about 70 topics.
MAX_UPLOAD_TOPICS = 1000
RECENT_TOPICS_SHOWN = 50


def parse_topics(text: str, source: str | None = None) -> list[ParsedTopic]:
    """Parse `category | topic | pro position | con position` lines; blank lines and `#` comments
    are skipped. Raises ValueError naming the first bad line (prefixed with `source` if given)."""
    topics = []
    for line_number, line in enumerate(text.splitlines(), 1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        fields = [field.strip() for field in line.split("|")]
        if len(fields) != 4 or any(not field or len(field) > 255 for field in fields):
            where = f"{source}:{line_number}:" if source else f"Line {line_number}:"
            raise ValueError(
                f"{where} expected category | topic | pro position | con position; "
                "each field must contain 1–255 characters."
            )
        topics.append((fields[0], fields[1], fields[2], fields[3]))
    return topics


async def add_topics(session: AsyncSession, topics: list[ParsedTopic], *, is_active: bool) -> int:
    """Add topics not already stored (identical category/topic/positions), including duplicates
    within `topics`. Returns how many were added. The caller owns the transaction."""
    repository = TopicRepository(session)
    added = 0
    for category, topic, pro_position, con_position in dict.fromkeys(topics):
        if await repository.get_by_content(topic, pro_position, con_position, category):
            continue
        repository.add(Topic(
            category=category,
            topic=topic,
            pro_position=pro_position,
            con_position=con_position,
            is_active=is_active,
        ))
        added += 1
    await session.flush()
    return added


class TopicService:
    """Admin topic management. Callers have already checked the admin list (`AdminUserDependency`)."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def upload(self, text: str, *, is_active: bool) -> TopicUploadResult:
        try:
            topics = parse_topics(text)
        except ValueError as error:
            raise TopicsInvalidError(str(error)) from error
        if not topics:
            raise TopicsInvalidError("No topics found. Add one per line.")
        if len(topics) > MAX_UPLOAD_TOPICS:
            raise TopicsInvalidError(f"Upload at most {MAX_UPLOAD_TOPICS} topics at a time.")
        # Loading the admin already began the session's transaction (BACKEND.md), so end it here.
        try:
            added = await add_topics(self.session, topics, is_active=is_active)
            await self.session.commit()
        except BaseException:
            await self.session.rollback()
            raise
        return TopicUploadResult(added=added, skipped=len(topics) - added)

    async def recent(self) -> AdminTopicsPage:
        repository = TopicRepository(self.session)
        rows = await repository.list_recent(RECENT_TOPICS_SHOWN)
        return AdminTopicsPage(
            total=await repository.count(),
            topics=[AdminTopic.model_validate(row) for row in rows],
        )
