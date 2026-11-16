import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import AppShell from "../../components/app-shell";
import EmptyState from "../../components/empty-state";
import PageHeader from "../../components/page-header";
import SiteHeader from "../../components/site-header";
import TopicUpload from "../../components/topic-upload";
import { backendUrl } from "../../lib/auth";
import { parseAdminTopicsPage, type AdminTopicsPage } from "../../lib/protocol";
import { forwardedCookie } from "../../lib/server-session";

export const metadata: Metadata = {
  title: "Topics · Admin · Chicken fAIght",
  robots: { index: false },
};


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
      <main aria-labelledby="topics-title" className="mx-auto w-full max-w-[1100px] flex-1 px-gutter py-8 xl:py-10">
        <PageHeader id="topics-title" eyebrow="Admin" title="Debate topics" description="Add topics in bulk. New matches pick from the active ones." />
        <div className="grid gap-stack">
          <TopicUpload />
          <section aria-labelledby="recent-title" className="panel p-panel">
            <div className="mb-4 flex items-baseline justify-between gap-4">
              <h2 id="recent-title" className="text-sm font-bold">Newest topics</h2>
              {page && <p className="text-xs text-ink-faint"><span className="stat text-base text-ink">{page.total.toLocaleString()}</span> in total</p>}
            </div>
            {page === null ? <p role="alert" className="well px-6 py-8 text-center text-sm font-semibold text-danger">Couldn’t load topics. Refresh to try again.</p>
              : page.topics.length === 0 ? <EmptyState title="No topics yet.">Upload a list above to get matches going.</EmptyState>
              : <div className="overflow-x-auto">
                <table className="w-full table-fixed text-left text-sm">
                  <thead className="eyebrow">
                    <tr>
                      <th scope="col" className="w-32 pb-3 font-medium">Category</th>
                      <th scope="col" className="pb-3 font-medium">Topic</th>
                      <th scope="col" className="pb-3 font-medium">Pro</th>
                      <th scope="col" className="pb-3 font-medium">Con</th>
                      <th scope="col" className="w-20 pb-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.topics.map((topic) => <tr key={topic.id} className="border-t border-line align-top">
                      <td className="break-words py-3 pr-4 text-ink-muted">{topic.category}</td>
                      <td className="break-words py-3 pr-4 font-semibold">{topic.topic}</td>
                      <td className="break-words py-3 pr-4 text-ink-muted">{topic.pro_position}</td>
                      <td className="break-words py-3 pr-4 text-ink-muted">{topic.con_position}</td>
                      <td className={`py-3 text-xs ${topic.is_active ? "text-win" : "text-ink-faint"}`}>{topic.is_active ? "Active" : "Inactive"}</td>
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
