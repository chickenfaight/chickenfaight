from uuid import UUID


class GameEngine:
    def __init__(self, match_id: UUID, players: tuple[UUID, UUID], model: str):
        # TODO figure out LLM identifier strategy
        self.players = players
        self.match_id = match_id
        self.model = model

    async def run(self):
        pass
