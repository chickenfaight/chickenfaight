import type { Metadata } from "next";
import { redirect } from "next/navigation";
import PageHeader from "../../components/page-header";
import DailyChallenge from "../../components/daily-challenge";
import { serverSession } from "../../lib/server-session";

export const metadata: Metadata = {
  title: "Daily challenge · Chicken fAIght",
  description: "Today's topic and twist. Finish it for bonus points.",
};

export default async function ChallengePage() {
  if (await serverSession() === "out") redirect("/login");
  return (
      <main aria-labelledby="challenge-title" className="mx-auto w-full max-w-[1200px] flex-1 px-gutter py-8 xl:py-10">
        <PageHeader id="challenge-title" title="Daily challenge" description="Everyone gets the same topic and twist." />
        <DailyChallenge />
      </main>
  );
}
