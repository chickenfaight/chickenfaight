import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AccountSettings from "../components/account-settings";
import AppShell from "../components/app-shell";
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
      <main aria-labelledby="settings-title" className="mx-auto w-full max-w-[900px] flex-1 px-6 py-10 xl:px-10">
        <h1 id="settings-title" className="mb-6 text-2xl font-bold tracking-tight">Settings</h1>
        <AccountSettings />
      </main>
    </AppShell>
  );
}
