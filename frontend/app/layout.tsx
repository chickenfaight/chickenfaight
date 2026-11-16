import type { Metadata } from "next";
import { Barlow_Condensed, Geist, Geist_Mono } from "next/font/google";
import FriendRequestsProvider from "./components/providers/friend-requests-provider";
import SessionProvider from "./components/providers/session-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// The display face: headlines, Elo, ranks, timers, and stats (with tabular numbers; see `stat` in globals.css).
const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Chicken fAIght · The debate arena",
  description: "Write your prompt. Let your AI do the talking. A competitive AI debate arena.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${barlowCondensed.variable} dark h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-canvas text-ink"><SessionProvider><FriendRequestsProvider>{children}</FriendRequestsProvider></SessionProvider></body>
    </html>
  );
}
