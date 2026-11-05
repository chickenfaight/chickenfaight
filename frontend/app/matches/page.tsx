import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AppShell from "../components/app-shell";
import MatchHistory from "../components/match-history";
import SiteHeader from "../components/site-header";
import { serverSession } from "../lib/server-session";

export const metadata: Metadata = {
  title: "Match history · Chicken fAIght",
  description: "Your past Chicken fAIght debates: wins, losses, and the models you used.",
};

export default async function MatchHistoryPage() {
  if (await serverSession() === "out") redirect("/login");
  return (
    <AppShell header={<SiteHeader />} scrollContent>
      <main aria-labelledby="matches-title" className="mx-auto w-full max-w-[1000px] flex-1 px-6 py-10 xl:px-10">
        <h1 id="matches-title" className="text-2xl font-bold tracking-tight">Match history</h1>
        <p className="mb-6 mt-1 text-sm text-zinc-400">Your finished debates, and the models you used. Only you can see this.</p>
        <MatchHistory />
      </main>
    </AppShell>
  );
}
