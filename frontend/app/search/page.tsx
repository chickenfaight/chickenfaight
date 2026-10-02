import type { Metadata } from "next";
import SiteHeader from "../components/site-header";
import SearchResults from "../components/search-results";

export const metadata: Metadata = {
  title: "Search players · Chicken fAIght",
  description: "Find Chicken fAIght players by tag.",
};

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const { q } = await searchParams;
  const query = (typeof q === "string" ? q : "").trim().slice(0, 64);

  return (
    <div className="flex min-h-svh flex-col bg-[#17181b] font-sans text-[#f5f3ef]">
      <SiteHeader query={query} />
      <main aria-labelledby="search-title" className="mx-auto w-full max-w-[1100px] flex-1 px-6 py-10 xl:px-10">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#f37981]">Players</p>
        <h1 id="search-title" className="mb-8 truncate text-2xl font-bold tracking-tight">
          {query ? <>Results for “{query}”</> : "Search players"}
        </h1>
        {query
          ? <SearchResults key={query} query={query} />
          : <p className="text-sm text-zinc-500">Type a tag in the search bar to find a player.</p>}
      </main>
    </div>
  );
}
