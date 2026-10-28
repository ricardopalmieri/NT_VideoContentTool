// Claude in Chrome blocks returned values that contain ? & or =. Every string that leaves
// window.vct passes through here; the full-width forms read the same to a person.
const FULL_WIDTH: Record<string, string> = { "?": "？", "&": "＆", "=": "＝" };

/** User text (clip names, titles) may contain ? & =; full-width forms read the same. */
export function safeText(raw: string) {
  return raw.replace(/[?&=]/g, (character) => FULL_WIDTH[character]);
}

/** Same filter for every string inside a result. dataUrl is binary (base64 ends in =) and stays as is. */
export function safeDeep<T>(value: T): T {
  if (typeof value === "string") return safeText(value) as T;
  if (Array.isArray(value)) return value.map(safeDeep) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === "dataUrl" ? item : safeDeep(item)])) as T;
  }
  return value;
}
