import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import AddFriendButton from "../../components/add-friend";
import BlockButton from "../../components/block-button";
import BlockedPlayers from "../../components/blocked-players";
import FriendRequests from "../../components/friend-requests";
import Avatar from "../../components/avatar";
import { linkClass } from "../../components/button";
import EmptyState from "../../components/empty-state";
import ErrorState from "../../components/error-state";
import AppShell from "../../components/app-shell";
import SiteHeader from "../../components/site-header";
import { backendUrl } from "../../lib/auth";
import { displayName, parseUser, parseUserPage, parseUserProfile, tagFormatError, type User, type UserPage, type UserProfile } from "../../lib/protocol";
import { profileHref } from "../../lib/routes";
import { forwardedCookie } from "../../lib/server-session";

export const metadata: Metadata = {
  title: "Profile · Chicken fAIght",
  description: "View a Chicken fAIght player's profile.",
};

const FRIENDS_SHOWN = 100;

// "blocked": the player blocked the viewer; only `profile.id`, `tag`, and `is_blocked` are real.
type Lookup = { status: "found" | "blocked"; profile: UserProfile } | { status: "missing" | "error" };

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

// The signed-in viewer, or null if it can't be read; the profile still renders without it.
async function viewer(): Promise<User | null> {
  try {
    const response = await backendGet("/auth/me");
    return response.ok ? parseUser(await response.json()) : null;
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
    const profile = parseUserProfile(await response.json());
    return { status: profile.read_blocked ? "blocked" : "found", profile };
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

// The players the signed-in player has blocked; null if they couldn't be loaded.
async function ownBlocked(): Promise<UserPage | null> {
  try {
    const response = await backendGet(`/v1/block?limit=${FRIENDS_SHOWN}`);
    return response.ok ? parseUserPage(await response.json()) : null;
  } catch {
    return null;
  }
}

// The signed-in player's pending requests in one direction; null if they couldn't be loaded.
async function ownRequests(direction: "incoming" | "outgoing"): Promise<UserPage | null> {
  try {
    const response = await backendGet(`/v1/friends/requests?direction=${direction}&limit=${FRIENDS_SHOWN}`);
    return response.ok ? parseUserPage(await response.json()) : null;
  } catch {
    return null;
  }
}

function Friends({ friends, incoming, outgoing }: Pick<ProfileProps, "friends" | "incoming" | "outgoing">) {
  return (
    <section aria-labelledby="friends-title" className="panel p-panel">
      <h2 id="friends-title" className="mb-5 text-sm font-bold">Friends</h2>
      <FriendRequests incoming={incoming} outgoing={outgoing} shown={FRIENDS_SHOWN} />
      {friends === null ? (
        <ErrorState compact message="Couldn’t load your friends. Try again in a moment." />
      ) : friends.items.length === 0 ? (
        <EmptyState title="No friends yet.">Find players with the search above and send a request from their profile.</EmptyState>
      ) : (
        <>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {friends.items.map((friend) => (
              <li key={friend.id}>
                <Link href={profileHref(friend.tag)} className="flex items-center gap-4 rounded-inset border border-line bg-inset/50 p-3 transition-colors duration-(--duration-fast) hover:border-line-strong focus-ring">
                  <Avatar name={displayName(friend)} url={friend.avatar_url} size={40} />
                  <span className="min-w-0"><span className="block truncate text-sm font-bold">{displayName(friend)}</span><span className="block truncate text-xs text-ink-faint">{friend.tag}</span></span>
                </Link>
              </li>
            ))}
          </ul>
          {friends.next_offset !== null && <p className="mt-4 text-xs text-ink-faint">Showing your first {FRIENDS_SHOWN} friends.</p>}
        </>
      )}
    </section>
  );
}

function Stat({ label, value, tone = "", big = false }: { label: string; value: string; tone?: string; big?: boolean }) {
  return <div><dt className="eyebrow">{label}</dt><dd className={`stat mt-2 ${big ? "text-6xl" : "text-4xl"} ${tone}`}>{value}</dd></div>;
}

const RANK_TONE = ["text-gold", "text-silver", "text-bronze"];

type ProfileProps = { profile: UserProfile; me: User | null; friends: UserPage | null; incoming: UserPage | null; outgoing: UserPage | null; blocked: UserPage | null };

function Profile({ profile, me, friends, incoming, outgoing, blocked }: ProfileProps) {
  const meId = me?.id ?? null;
  const games = profile.ratings.reduce((sum, rating) => sum + rating.games_played, 0);
  const wins = profile.ratings.reduce((sum, rating) => sum + rating.wins, 0);
  const losses = profile.ratings.reduce((sum, rating) => sum + rating.losses, 0);
  const rated = profile.ratings.filter((rating) => rating.games_played > 0);
  const best = rated.length ? Math.max(...rated.map((rating) => rating.elo)) : null;

  return (
    <div className="flex flex-col gap-stack">
      <section aria-labelledby="profile-title" className="flex items-center gap-7 py-2 animate-rise">
        <span className="max-[640px]:hidden"><Avatar name={displayName(profile)} url={profile.avatar_url} size={112} ring="border-2 border-accent/50" /></span>
        <div className="min-w-0">
          <p className="eyebrow mb-2 text-accent-ink">Player</p>
          <h1 id="profile-title" className="headline truncate text-6xl">{displayName(profile)}</h1>
          <p className="mt-1 truncate text-sm text-ink-muted"><span className="sr-only">Tag: </span>{profile.tag}</p>
          {meId === profile.id && me?.email && <p className="mt-2 truncate text-xs text-ink-faint">{me.email} <span className="text-ink-faint/70">· only you can see this</span></p>}
          {meId && meId !== profile.id && <div className="mt-4 flex flex-wrap items-start gap-x-3 gap-y-2">
            {/* Neither player can send a request while blocked; unblocking remounts it with fresh state. */}
            {!profile.is_blocked && <AddFriendButton key={profile.id} userId={profile.id} initialIsFriend={profile.is_friend} initialRequest={profile.friend_request} />}
            <BlockButton key={`block-${profile.id}`} userId={profile.id} initialIsBlocked={profile.is_blocked} />
          </div>}
        </div>
      </section>
      <section aria-labelledby="record-title" className="panel p-panel animate-rise [animation-delay:60ms]">
        <div className="mb-6 flex items-baseline justify-between gap-3">
          <h2 id="record-title" className="text-sm font-bold">Record</h2>
          {meId === profile.id && <Link href="/matches" className={`text-xs ${linkClass}`}>Debate history</Link>}
        </div>
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-x-4 gap-y-6 border-b border-line pb-6">
          {profile.rank !== null && <Stat big label="Rank" value={`#${profile.rank.toLocaleString()}`} tone={RANK_TONE[profile.rank - 1] ?? ""} />}
          <Stat big label="Points" value={profile.points.toLocaleString()} />
          {best !== null && <Stat big label="Best Elo" value={String(best)} />}
          {profile.streak > 0 && <Stat big label="Streak" value={`${profile.streak} ${profile.streak === 1 ? "day" : "days"}`} tone="text-gold" />}
        </dl>
        {games === 0 ? (
          <p className="pt-6 text-sm text-ink-faint">No debates yet.</p>
        ) : (
          <dl className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-4 pt-6">
            <Stat label="Win rate" value={`${Math.round((wins / games) * 100)}%`} />
            <Stat label="Debates played" value={games.toLocaleString()} />
            <Stat label="Wins" value={wins.toLocaleString()} tone={wins > 0 ? "text-win" : ""} />
            <Stat label="Losses" value={losses.toLocaleString()} />
          </dl>
        )}
      </section>
      {meId === profile.id && <Friends friends={friends} incoming={incoming} outgoing={outgoing} />}
      {meId === profile.id && <BlockedPlayers blocked={blocked} shown={FRIENDS_SHOWN} />}
    </div>
  );
}

export default async function ProfilePage({ params }: PageProps<"/profile/[tag]">) {
  // Tags are plain ASCII, so anything still percent-encoded fails the format check as a missing player.
  const { tag } = await params;
  if (tag === "me") await redirectToOwnProfile();
  const [result, me] = await Promise.all([lookUp(tag), viewer()]);
  const meId = me?.id ?? null;
  const own = result.status === "found" && meId === result.profile.id;
  const [friends, incoming, outgoing, blocked] = own
    ? await Promise.all([ownFriends(), ownRequests("incoming"), ownRequests("outgoing"), ownBlocked()])
    : [null, null, null, null];

  return (
    <AppShell header={<SiteHeader />}>
      <main className="mx-auto w-full max-w-[1100px] flex-1 px-gutter py-8 xl:py-10">
        {result.status === "found" ? <Profile profile={result.profile} me={me} friends={friends} incoming={incoming} outgoing={outgoing} blocked={blocked} /> : (
          <section aria-labelledby="profile-title" className="well flex flex-col items-center px-6 py-14 text-center animate-fade">
            <h1 id="profile-title" className="headline text-3xl">{result.status === "missing" ? "Player not found" : "Profile unavailable"}</h1>
            <p className={`mt-2 max-w-full truncate text-sm ${result.status === "error" ? "text-danger" : "text-ink-faint"}`}>
              {result.status === "missing" ? `No player goes by “${tag}”. Check the tag or search for them above.`
              : (result.status === "blocked" ? "You have been blocked from this profile."
              : "Couldn’t load this profile. Try again in a moment.")}
            </p>
            {result.status === "blocked" && meId && (
              <div className="mt-4"><BlockButton key={`block-${result.profile.id}`} userId={result.profile.id} initialIsBlocked={result.profile.is_blocked} /></div>
            )}
          </section>
        )}
      </main>
    </AppShell>
  );
}
