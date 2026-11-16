import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AppShell from "../components/app-shell";
import PageHeader from "../components/page-header";
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
      <main aria-labelledby="bilc-title" className="mx-auto w-full max-w-[900px] flex-1 px-gutter py-8 xl:py-10">
        <PageHeader id="bilc-title" eyebrow="BILC" title="Bring your own model" description="Pair BILC, the BYOM Interface Layer Client, to play with a model on your own computer." />
        <BilcDevices />
      </main>
    </AppShell>
  );
}
