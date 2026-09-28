import type { Metadata } from "next";
import Link from "next/link";
import { backendUrl } from "../lib/auth";
import Image from "next/image";
import { cookies } from "next/headers";

export const metadata: Metadata = {
  title: "Profile · Chickenfaight",
  description: "View a Chickenfaight profile.",
};

type User = {
  username: string;
  avatarUrl: string | null;
  email: string | null;
  elo: int;
};

async function getCurrentUser(): Promise<User | null> {
	const cookieStore = await cookies();
	const response = await fetch(`${backendUrl}/auth/me`, {
	  headers: { cookie: cookieStore.toString() },
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });

	const responseText = await response.text();
    let data: unknown;
	
    data = JSON.parse(responseText);
	
	
	
  return {
    username: data.username,
	email: data.email,
    avatarUrl: data.avatarUrl,
	elo: data.elo,
  };
}

export default async function ProfilePage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return (
	<main className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 text-zinc-100">
      <section className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-8 shadow-2xl shadow-black/30">
        <p className="mb-2 text-sm font-medium uppercase tracking-[0.2em] text-zinc-500">
          Chickenfaight
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Profile
        </h1>

        <div className="mt-8 flex items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-950/70 p-5">
			<Image
			src={user.avatarUrl ?? "/next.svg"}
			alt={`${user.username}'s profile picture`}
			width={128}
			height={128}
			className="h-32 w-32 rounded-full object-cover"
			priority
			/>
          <div>
            <p className="font-large">
              {`Username: ${user.username}`}
            </p>
			<p className="font-large">
              {`Email: ${user.email}`}
            </p>
			<p className="font-large">
              {`ELO: ${user.elo}`}
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}