import path from "node:path";

export function sanitizeFileName(name = "image.png") {
  const parsed = path.parse(name);
  const ext = parsed.ext.toLowerCase().replace(/[^.\w]/g, "");
  const base = parsed.name
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\.\.+/g, ".")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120);
  return `${base || "image"}${ext || ".png"}`;
}
