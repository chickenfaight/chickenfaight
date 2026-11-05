import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AppShell from "../../components/app-shell";
import MatchDetail from "../../components/match-detail";
import SiteHeader from "../../components/site-header";
import { serverSession } from "../../lib/server-session";

export const metadata: Metadata = {
  title: "Debate · Chicken fAIght",
  description: "A finished Chicken fAIght debate.",
};

export default async function MatchDetailPage({ params }: PageProps<"/matches/[match_id]">) {
  if (await serverSession() === "out") redirect("/login");
  const { match_id: matchId } = await params;
  return (
    <AppShell header={<SiteHeader />} scrollContent>
      <main className="mx-auto w-full max-w-[1100px] flex-1 px-6 py-8 xl:px-10">
        <MatchDetail matchId={matchId} />
      </main>
    </AppShell>
  );
}
