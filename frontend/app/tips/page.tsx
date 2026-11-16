import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AppShell from "../components/app-shell";
import PageHeader from "../components/page-header";
import SiteHeader from "../components/site-header";
import TipsChat from "../components/tips-chat";
import { serverSession } from "../lib/server-session";

export const metadata: Metadata = {
  title: "Debate tips · Chicken fAIght",
  description: "Get strategy advice from your chosen model.",
};

export default async function TipsPage() {
  if (await serverSession() === "out") redirect("/login");
  return (
    <AppShell header={<SiteHeader />}>
      <main aria-labelledby="tips-page-title" className="mx-auto w-full max-w-[1200px] flex-1 px-gutter py-8 xl:py-10">
        <PageHeader id="tips-page-title" eyebrow="Coaching" title="Debate tips" description="Your chosen model coaches you on writing winning strategy prompts." />
        <TipsChat />
      </main>
    </AppShell>
  );
}
