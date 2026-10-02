import Image from "next/image";

// Only Google profile pictures are allowed by next.config.ts; anything else falls back to initials.
const AVATAR_HOST = "lh3.googleusercontent.com";

function isAllowedAvatar(url: string | null): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === AVATAR_HOST;
  } catch {
    return false;
  }
}

export default function Avatar({ username, url, size }: { username: string; url: string | null; size: number }) {
  if (isAllowedAvatar(url)) {
    return <Image src={url} alt="" width={size} height={size} referrerPolicy="no-referrer" className="shrink-0 rounded-full border border-white/10 object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span aria-hidden="true" className="flex shrink-0 items-center justify-center rounded-full border border-[#f04b58]/30 bg-[#f04b58]/10 font-bold text-[#ff7882]" style={{ width: size, height: size, fontSize: size * 0.36 }}>
      {username.slice(0, 2).toUpperCase()}
    </span>
  );
}
