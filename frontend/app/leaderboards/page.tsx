import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AppShell from "../components/app-shell";
import Leaderboards from "../components/leaderboards";
import SiteHeader from "../components/site-header";
import { serverSession } from "../lib/server-session";

export const metadata: Metadata = {
  title: "Leaderboards · Chicken fAIght",
  description: "See the top ranked players in each Chicken fAIght arena.",
};

export default async function LeaderboardsPage() {
  if (await serverSession() === "out") redirect("/login");

  return (
    <AppShell header={<SiteHeader current="leaderboards" />} scrollContent>
      <main aria-labelledby="leaderboards-title" className="mx-auto w-full max-w-[1080px] px-6 py-5 xl:px-10">
        <Leaderboards />
      </main>
    </AppShell>
  );
}
