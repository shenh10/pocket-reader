export const PUBLIC_SITE = "https://shenhan.cc/pocket-reader/";
export function routeFromLink(value, localBase) {
  try {
    const input = new URL(value),
      base = new URL(localBase);
    let route;
    if (input.protocol === "pocketreader:") {
      const kind =
        input.hostname || input.pathname.split("/").filter(Boolean)[0];
      if (kind === "daily") route = "ai-infra-board/";
      else if (kind === "learn") route = "nvidia-docs/";
      else if (kind === "home") route = "";
      else return null;
    } else {
      const published = new URL(PUBLIC_SITE);
      if (
        input.origin !== published.origin ||
        !input.pathname.startsWith(published.pathname)
      )
        return null;
      route = input.pathname.slice(published.pathname.length);
      if (
        !/^(?:$|index\.html$|settings\.html$|ai-infra-board\/(?:index\.html)?$|nvidia-docs\/[\w/.-]*(?:\.html)?$)/.test(
          route,
        )
      )
        return null;
    }
    const target = new URL(route, base);
    if (!target.href.startsWith(base.href)) return null;
    const date = input.searchParams.get("date");
    if (
      date &&
      /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      route.startsWith("ai-infra-board/")
    )
      target.searchParams.set("date", date);
    if (/^#[a-zA-Z0-9_-]+$/.test(input.hash)) target.hash = input.hash;
    return target.href;
  } catch {
    return null;
  }
}
export function publishedUrl(current, localBase) {
  const url = new URL(current),
    base = new URL(localBase);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname))
    return PUBLIC_SITE;
  return new URL(
    url.pathname.slice(base.pathname.length) + url.search + url.hash,
    PUBLIC_SITE,
  ).href;
}
