import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import AuthLayout from "../components/auth-layout";
import LoginForm from "../components/login-form";
import { backendUrl } from "../lib/auth";
import { serverSession } from "../lib/server-session";

export const metadata: Metadata = {
  title: "Log in · Chickenfaight",
  description: "Sign in to Chickenfaight.",
};

export default async function LoginPage() {
  // Already signed in with a valid session: skip the login screen.
  if (await serverSession() === "in") redirect("/");
  return (
    <AuthLayout eyebrow="A seat in the arena" heading="Welcome to the coop." intro={<>Sign in to find your next opponent.<br />Your best argument starts here.</>}>
      <LoginForm />
              <a href={`${backendUrl}/auth/google/login`} className="mt-8 flex min-h-12 w-full items-center justify-center gap-3 rounded-xl bg-[#f5f3ef] px-4 py-3 text-sm font-semibold text-zinc-950 transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.89-1.74 2.98-4.31 2.98-7.36Z" />
              <path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.97-3.38.97-2.6 0-4.81-1.76-5.6-4.12H3.06v2.59A10 10 0 0 0 12 22Z" />
              <path fill="#FBBC05" d="M6.4 13.93a6 6 0 0 1 0-3.86V7.48H3.06a10 10 0 0 0 0 9.04l3.34-2.59Z" />
              <path fill="#EA4335" d="M12 5.95c1.47 0 2.79.51 3.83 1.51l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.94 5.48l3.34 2.59A5.99 5.99 0 0 1 12 5.95Z" />
            </svg>
                Continue with Google
              </a>
      <p className="mt-4 text-center text-[11px] leading-5 text-zinc-500">New here? <Link href="/signup" className="font-semibold text-[#ff7882] hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">Create an account</Link> or continue with Google.</p>
    </AuthLayout>
  );
}
