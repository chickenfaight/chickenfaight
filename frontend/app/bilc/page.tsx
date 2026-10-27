import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AppShell from "../components/app-shell";
import BilcDevices from "../components/bilc-devices";
import SiteHeader from "../components/site-header";
import { serverSession } from "../lib/server-session";

export const metadata: Metadata = {
  title: "BILC · Chicken fAIght",
  description: "Pair BILC to bring your own model to the BYOM arena.",
};

export default async function BilcPage() {
  if (await serverSession() === "out") redirect("/login");
  return (
    <AppShell header={<SiteHeader />}>
      <main aria-labelledby="bilc-title" className="mx-auto w-full max-w-[900px] flex-1 px-6 py-10 xl:px-10">
        <h1 id="bilc-title" className="text-2xl font-bold tracking-tight">Bring your own model</h1>
        <p className="mb-6 mt-1 text-sm text-zinc-400">Pair BILC, the BYOM Interface Layer Client, to play with a model on your own computer.</p>
        <BilcDevices />
      </main>
    </AppShell>
  );
}
