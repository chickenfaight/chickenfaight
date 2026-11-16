import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AccountSettings from "../components/account-settings";
import AppShell from "../components/app-shell";
import PageHeader from "../components/page-header";
import SiteHeader from "../components/site-header";
import { serverSession } from "../lib/server-session";

export const metadata: Metadata = {
  title: "Settings · Chicken fAIght",
  description: "Manage your Chicken fAIght account.",
};

export default async function SettingsPage() {
  if (await serverSession() === "out") redirect("/login");
  return (
    <AppShell header={<SiteHeader />}>
      <main aria-labelledby="settings-title" className="mx-auto w-full max-w-[900px] flex-1 px-gutter py-8 xl:py-10">
        <PageHeader id="settings-title" eyebrow="Account" title="Settings" description="Your name, picture, and email. Your tag is permanent." />
        <AccountSettings />
      </main>
    </AppShell>
  );
}
