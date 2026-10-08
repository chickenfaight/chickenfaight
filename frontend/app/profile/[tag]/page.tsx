import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import AddFriendButton from "../../components/add-friend";
import Avatar from "../../components/avatar";
import SiteHeader from "../../components/site-header";
import { backendUrl } from "../../lib/auth";
import { displayName, parseUser, parseUserPage, parseUserProfile, tagFormatError, type UserPage, type UserProfile } from "../../lib/protocol";
import { profileHref } from "../../lib/routes";
import { forwardedCookie } from "../../lib/server-session";

export const metadata: Metadata = {
  title: "Profile · Chicken fAIght",
  description: "View a Chicken fAIght player's profile.",
};

const panel = "rounded-3xl border border-white/[0.07] bg-[#202124]";
const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white";
const FRIENDS_SHOWN = 100;

type Lookup = { status: "found"; profile: UserProfile } | { status: "missing" | "error" };

// Server-side fetches forward the browser's session cookie to the backend.
async function backendGet(path: string): Promise<Response> {
  return fetch(`${backendUrl}${path}`, {
    headers: { cookie: await forwardedCookie() },
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
}

// `/profile/me` resolves the signed-in user's tag and redirects to their canonical profile URL.
async function redirectToOwnProfile(): Promise<never> {
  let target = "/";
  try {
    const response = await backendGet("/auth/me");
    if (response.status === 401) target = "/login";
    else if (response.ok) {
      const { tag } = parseUser(await response.json());
      if (tag) target = profileHref(tag);
    }
  } catch {
    // Fall through to the lobby, which shows its own session error.
  }
  redirect(target);
}

// The viewer's own ID, or null if it can't be read; the profile still renders without it.
async function viewerId(): Promise<string | null> {
  try {
    const response = await backendGet("/auth/me");
    return response.ok ? parseUser(await response.json()).id : null;
  } catch {
    return null;
  }
}

async function lookUp(tag: string): Promise<Lookup> {
  // A tag that breaks the format rule can't exist, so skip the request.
  if (tagFormatError(tag)) return { status: "missing" };
  let response: Response;
  try {
    response = await backendGet(`/v1/users/by-tag/${encodeURIComponent(tag)}`);
  } catch {
    return { status: "error" };
  }
  if (response.status === 401) redirect("/login");
  if (response.status === 404) return { status: "missing" };
  if (!response.ok) return { status: "error" };
  try {
    return { status: "found", profile: parseUserProfile(await response.json()) };
  } catch {
    return { status: "error" };
  }
}

// The signed-in player's own friends; null if they couldn't be loaded.
async function ownFriends(): Promise<UserPage | null> {
  try {
    const response = await backendGet(`/v1/friends?limit=${FRIENDS_SHOWN}`);
    return response.ok ? parseUserPage(await response.json()) : null;
  } catch {
    return null;
  }
}

function Friends({ friends }: { friends: UserPage | null }) {
  return (
    <section aria-labelledby="friends-title" className={`${panel} col-span-2 p-6`}>
      <h2 id="friends-title" className="mb-5 text-sm font-bold">Friends</h2>
      {friends === null ? (
        <p className="text-sm text-zinc-500">Couldn’t load your friends. Try again in a moment.</p>
      ) : friends.items.length === 0 ? (
        <p className="text-sm text-zinc-500">No friends yet. Find players with the search above and add them from their profile.</p>
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-3 xl:grid-cols-3">
            {friends.items.map((friend) => (
              <li key={friend.id}>
                <Link href={profileHref(friend.tag)} className={`flex items-center gap-4 rounded-2xl border border-white/[0.07] p-3 hover:border-white/20 ${focus}`}>
                  <Avatar name={displayName(friend)} url={friend.avatar_url} size={40} />
                  <span className="min-w-0"><span className="block truncate text-sm font-bold">{displayName(friend)}</span><span className="block truncate text-xs text-zinc-500">{friend.tag}</span></span>
                </Link>
              </li>
            ))}
          </ul>
          {friends.next_offset !== null && <p className="mt-4 text-xs text-zinc-500">Showing your first {FRIENDS_SHOWN} friends.</p>}
        </>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[10px] text-zinc-400">{label}</p><p className="mt-1 text-2xl font-bold tracking-tight">{value}</p></div>;
}

type ProfileProps = { profile: UserProfile; meId: string | null; friends: UserPage | null };

function Profile({ profile, meId, friends }: ProfileProps) {
  const games = profile.ratings.reduce((sum, rating) => sum + rating.games_played, 0);
  const wins = profile.ratings.reduce((sum, rating) => sum + rating.wins, 0);
  const losses = profile.ratings.reduce((sum, rating) => sum + rating.losses, 0);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-5">
      <section aria-labelledby="profile-title" className={`${panel} flex items-center gap-7 p-9`}>
        <Avatar name={displayName(profile)} url={profile.avatar_url} size={112} />
        <div className="min-w-0">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#f37981]">Player</p>
          <h1 id="profile-title" className="truncate text-4xl font-black tracking-[-0.045em]">{displayName(profile)}</h1>
          <p className="mt-1 truncate text-sm text-zinc-400"><span className="sr-only">Tag: </span>{profile.tag}</p>
          {meId && meId !== profile.id && <AddFriendButton userId={profile.id} initialIsFriend={profile.is_friend} />}
        </div>
      </section>
      <section aria-labelledby="record-title" className={`${panel} p-6`}>
        <h2 id="record-title" className="mb-5 text-sm font-bold">Record</h2>
        {games === 0 ? (
          <p className="text-sm text-zinc-500">No debates yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-y-5">
            <Stat label="Win rate" value={`${Math.round((wins / games) * 100)}%`} />
            <Stat label="Debates played" value={games.toLocaleString()} />
            <Stat label="Wins" value={wins.toLocaleString()} />
            <Stat label="Losses" value={losses.toLocaleString()} />
          </div>
        )}
      </section>
      {meId === profile.id && <Friends friends={friends} />}
    </div>
  );
}

export default async function ProfilePage({ params }: PageProps<"/profile/[tag]">) {
  // Tags are plain ASCII, so anything still percent-encoded fails the format check as a missing player.
  const { tag } = await params;
  if (tag === "me") await redirectToOwnProfile();
  const [result, meId] = await Promise.all([lookUp(tag), viewerId()]);
  const friends = result.status === "found" && meId === result.profile.id ? await ownFriends() : null;

  return (
    <div className="flex min-h-svh flex-col bg-[#17181b] font-sans text-[#f5f3ef]">
      <SiteHeader />
      <main className="mx-auto w-full max-w-[1100px] flex-1 px-6 py-10 xl:px-10">
        {result.status === "found" ? <Profile profile={result.profile} meId={meId} friends={friends} /> : (
          <section aria-labelledby="profile-title" className={`${panel} p-9`}>
            <h1 id="profile-title" className="text-xl font-bold">{result.status === "missing" ? "Player not found" : "Profile unavailable"}</h1>
            <p className="mt-2 truncate text-sm text-zinc-500">
              {result.status === "missing" ? `No player goes by “${tag}”. Check the tag or search for them above.` : "Couldn’t load this profile. Try again in a moment."}
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
