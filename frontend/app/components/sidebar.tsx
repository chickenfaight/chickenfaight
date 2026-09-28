import Link from 'next/link';

export default function Sidebar() {
  return (
    <aside className="rounded-xl border border-zinc-800 bg-zinc-950/70 w-64 h-screen fixed top-0 left-0 p-5 flex flex-col gap-4">
      <div className="font-bold text-xl mb-4">ChichenFaight</div>
      <nav className="flex flex-col gap-2">
        <Link href="/" className="font-medium text-zinc-950 dark:text-zinc-50 hover:bg-gray-800 p-2 rounded transition">Home</Link>
		<Link href="/health" className="font-medium text-zinc-950 dark:text-zinc-50 hover:bg-gray-800 p-2 rounded transition">Health Check</Link>
		<Link href="/profile" className="font-medium text-zinc-950 dark:text-zinc-50 hover:bg-gray-800 p-2 rounded transition">Profile</Link>
      </nav>
    </aside>
  );
}