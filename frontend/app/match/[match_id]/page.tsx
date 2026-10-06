import MatchArena from "../../components/match-arena";
import { MatchProvider } from "../../components/providers/match-provider";

export default async function MatchPage({ params }: { params: Promise<{ match_id: string }> }) {
  const { match_id } = await params;
  return <MatchProvider key={match_id} matchId={match_id}><MatchArena /></MatchProvider>;
}
