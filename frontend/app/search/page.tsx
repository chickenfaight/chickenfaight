import type { Metadata } from "next";
import AppShell from "../components/app-shell";
import EmptyState from "../components/empty-state";
import PageHeader from "../components/page-header";
import SiteHeader from "../components/site-header";
import SearchResults from "../components/search-results";

export const metadata: Metadata = {
  title: "Search players · Chicken fAIght",
  description: "Find Chicken fAIght players by username or tag.",
};

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const { q } = await searchParams;
  const query = (typeof q === "string" ? q : "").trim().slice(0, 64);

  return (
    <AppShell header={<SiteHeader query={query} />}>
      <main aria-labelledby="search-title" className="mx-auto w-full max-w-[1100px] flex-1 px-gutter py-8 xl:py-10">
        <PageHeader id="search-title" eyebrow="Players" title={query ? <>Results for “{query}”</> : "Search players"} />
        {query
          ? <SearchResults key={query} query={query} />
          : <EmptyState title="Find a player">Type a username or tag in the search bar to find a player.</EmptyState>}
      </main>
    </AppShell>
  );
}
