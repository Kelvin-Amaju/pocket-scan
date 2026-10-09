export function categoryFor(mime = "", name = "") {
  if (
    mime.startsWith("image/") ||
    /\.(jpe?g|png|webp|gif|heic|heif|avif|bmp)$/i.test(name)
  )
    return "photos";
  if (mime.startsWith("video/") || /\.(mp4|mkv|webm|mov|avi|m4v)$/i.test(name))
    return "videos";
  if (
    mime.startsWith("audio/") ||
    /\.(mp3|m4a|aac|ogg|wav|flac|opus)$/i.test(name)
  )
    return "audio";
  return "other";
}
export function bytes(n) {
  if (!n) return "0 B";
  const i = Math.min(4, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${["B", "KB", "MB", "GB", "TB"][i]}`;
}
export function dedupe(items) {
  return [...new Map(items.map((x) => [x.id, x])).values()];
}
export function filterEntries(items, query, category, sort) {
  const q = query.trim().toLowerCase();
  return items
    .filter(
      (x) =>
        (!category || x.category === category) &&
        (!q || `${x.name} ${x.folder}`.toLowerCase().includes(q)),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : sort === "size"
          ? b.size - a.size
          : b.modified - a.modified,
    );
}
