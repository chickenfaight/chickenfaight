import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import AppShell from "../../components/app-shell";
import SiteHeader from "../../components/site-header";
import TopicUpload from "../../components/topic-upload";
import { backendUrl } from "../../lib/auth";
import { parseAdminTopicsPage, type AdminTopicsPage } from "../../lib/protocol";
import { forwardedCookie } from "../../lib/server-session";

export const metadata: Metadata = {
  title: "Topics · Admin · Chicken fAIght",
  robots: { index: false },
};

const panel = "rounded-3xl border border-white/[0.07] bg-[#202124]";

// The backend decides who is an admin: 401 goes to sign-in, and 403 looks like any missing page.
async function loadTopics(): Promise<AdminTopicsPage | null> {
  let response: Response;
  try {
    response = await fetch(`${backendUrl}/v1/admin/topics`, {
      headers: { cookie: await forwardedCookie() },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return null;
  }
  if (response.status === 401) redirect("/login");
  if (response.status === 403) notFound();
  if (!response.ok) return null;
  try {
    return parseAdminTopicsPage(await response.json());
  } catch {
    return null;
  }
}

export default async function AdminTopicsPage() {
  const page = await loadTopics();
  return (
    <AppShell header={<SiteHeader />}>
      <main aria-labelledby="topics-title" className="mx-auto w-full max-w-[1100px] flex-1 px-6 py-10 xl:px-10">
        <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-zinc-500">Admin</p>
        <h1 id="topics-title" className="mb-6 mt-1 text-2xl font-bold tracking-tight">Debate topics</h1>
        <div className="grid gap-5">
          <TopicUpload />
          <section aria-labelledby="recent-title" className={`${panel} p-7`}>
            <div className="mb-4 flex items-baseline justify-between gap-4">
              <h2 id="recent-title" className="text-sm font-bold">Newest topics</h2>
              {page && <p className="text-xs text-zinc-500">{page.total} in total</p>}
            </div>
            {page === null ? <p className="text-sm text-red-300">Couldn’t load topics. Refresh to try again.</p>
              : page.topics.length === 0 ? <p className="text-sm text-zinc-500">No topics yet.</p>
              : <div className="overflow-x-auto">
                <table className="w-full table-fixed text-left text-sm">
                  <thead className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
                    <tr>
                      <th scope="col" className="w-32 pb-3 font-medium">Category</th>
                      <th scope="col" className="pb-3 font-medium">Topic</th>
                      <th scope="col" className="pb-3 font-medium">Pro</th>
                      <th scope="col" className="pb-3 font-medium">Con</th>
                      <th scope="col" className="w-20 pb-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.topics.map((topic) => <tr key={topic.id} className="border-t border-white/[0.07] align-top">
                      <td className="break-words py-3 pr-4 text-zinc-400">{topic.category}</td>
                      <td className="break-words py-3 pr-4 font-semibold">{topic.topic}</td>
                      <td className="break-words py-3 pr-4 text-zinc-300">{topic.pro_position}</td>
                      <td className="break-words py-3 pr-4 text-zinc-300">{topic.con_position}</td>
                      <td className={`py-3 text-xs ${topic.is_active ? "text-zinc-300" : "text-zinc-500"}`}>{topic.is_active ? "Active" : "Inactive"}</td>
                    </tr>)}
                  </tbody>
                </table>
              </div>}
          </section>
        </div>
      </main>
    </AppShell>
  );
}
