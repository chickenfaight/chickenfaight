import { redirect } from "next/navigation";
import Lobby from "./components/lobby";
import { serverSession } from "./lib/server-session";

export default async function Home() {
  // No valid session (never signed in, expired, or logged out): go to the login screen.
  if (await serverSession() === "out") redirect("/login");
  return <Lobby />;
}
