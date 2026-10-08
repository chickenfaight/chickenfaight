export function profileHref(tag: string): string {
  return `/profile/${encodeURIComponent(tag)}`;
}

export function searchHref(query: string): string {
  return `/search?q=${encodeURIComponent(query)}`;
}
