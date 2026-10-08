import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import AuthLayout from "../components/auth-layout";
import SignupForm from "../components/signup-form";
import { serverSession } from "../lib/server-session";

export const metadata: Metadata = {
  title: "Sign up · Chickenfaight",
  description: "Create a Chickenfaight account.",
};

export default async function SignupPage() {
  // Already signed in with a valid session: nothing to sign up for.
  if (await serverSession() === "in") redirect("/");
  return (
    <AuthLayout eyebrow="Join the coop" heading="Create your account." intro="Pick a tag, a username, and a password.">
      <SignupForm />
      <p className="mt-2 text-center text-[11px] leading-5 text-zinc-500">Already have an account? <Link href="/login" className="font-semibold text-[#ff7882] hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">Sign in</Link></p>
    </AuthLayout>
  );
}
