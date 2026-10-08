import Image from "next/image";
import { backendUrl } from "../lib/auth";

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

// `name` supplies the initials when there is no picture: the username, or the tag without one.
// Uploaded pictures are served by the backend at a relative `/v1/users/{id}/avatar?v=…` path.
function isUploadedAvatar(url: string | null): url is string {
  return url !== null && /^\/v1\/users\/[0-9a-f-]{36}\/avatar\?v=[0-9a-f]+$/.test(url);
}

export default function Avatar({ name, url, size }: { name: string; url: string | null; size: number }) {
  if (isUploadedAvatar(url)) {
    // `unoptimized`: the browser fetches it directly, sending the session cookie the route requires.
    return <Image src={`${backendUrl}${url}`} alt="" width={size} height={size} unoptimized className="shrink-0 rounded-full border border-white/10 object-cover" style={{ width: size, height: size }} />;
  }
  if (isAllowedAvatar(url)) {
    return <Image src={url} alt="" width={size} height={size} referrerPolicy="no-referrer" className="shrink-0 rounded-full border border-white/10 object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span aria-hidden="true" className="flex shrink-0 items-center justify-center rounded-full border border-[#f04b58]/30 bg-[#f04b58]/10 font-bold text-[#ff7882]" style={{ width: size, height: size, fontSize: size * 0.36 }}>
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}
