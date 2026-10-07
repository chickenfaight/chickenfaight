export function profileHref(username: string): string {
  return `/profile/${encodeURIComponent(username)}`;
}

export function searchHref(query: string): string {
  return `/search?q=${encodeURIComponent(query)}`;
}
