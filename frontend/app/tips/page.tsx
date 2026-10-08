import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AppShell from "../components/app-shell";
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
      <main aria-labelledby="tips-page-title" className="mx-auto w-full max-w-[1200px] flex-1 px-6 py-10 xl:px-10">
        <h1 id="tips-page-title" className="text-2xl font-bold tracking-tight">Debate tips</h1>
        <p className="mb-6 mt-1 text-sm text-zinc-400">Your chosen model coaches you on writing winning strategy prompts.</p>
        <TipsChat />
      </main>
    </AppShell>
  );
}
