import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AppShell from "../components/app-shell";
import PageHeader from "../components/page-header";
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
      <main aria-labelledby="matches-title" className="mx-auto w-full max-w-[1000px] flex-1 px-gutter py-8 xl:py-10">
        <PageHeader id="matches-title" eyebrow="Your record" title="Match history" description="Your finished debates, and the models you used. Only you can see this." />
        <MatchHistory />
      </main>
    </AppShell>
  );
}
