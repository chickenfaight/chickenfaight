import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AppShell from "../components/app-shell";
import DailyChallenge from "../components/daily-challenge";
import SiteHeader from "../components/site-header";
import { serverSession } from "../lib/server-session";

export const metadata: Metadata = {
  title: "Daily challenge · Chicken fAIght",
  description: "Today's topic and twist. Finish it for bonus points.",
};

export default async function ChallengePage() {
  if (await serverSession() === "out") redirect("/login");
  return (
    <AppShell header={<SiteHeader />}>
      <main aria-labelledby="challenge-title" className="mx-auto w-full max-w-[1200px] flex-1 px-6 py-10 xl:px-10">
        <h1 id="challenge-title" className="mb-6 text-2xl font-bold tracking-tight">Daily challenge</h1>
        <DailyChallenge />
      </main>
    </AppShell>
  );
}
