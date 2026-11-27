export const PUBLIC_SITE = "https://shenhan.cc/pocket-reader/";
export function localPageUrl(value, localBase, native = false) {
  const url = new URL(value, localBase), base = new URL(localBase);
  if (native && url.protocol === base.protocol && url.host === base.host && url.pathname.startsWith(base.pathname) && url.pathname.endsWith("/"))
    url.pathname += "index.html";
  return url;
}
export function routeFromLink(value, localBase, native = false) {
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
    const target = localPageUrl(route, base, native);
    if (!target.href.startsWith(base.href)) return null;
    const date = input.searchParams.get("date");
    if (
      date &&
      /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      route.startsWith("ai-infra-board/")
    )
      target.searchParams.set("date", date);
    if (route.startsWith("ai-infra-board/") && input.searchParams.get("view") === "topics") {
      target.searchParams.set("view", "topics");
      const topic = input.searchParams.get("topic");
      if (topic && /^[a-z][a-z0-9-]{0,79}$/.test(topic)) target.searchParams.set("topic", topic);
    }
    // Heading anchors include Chinese characters; decode before validating and
    // let URL serialize the fragment again. Never carry arbitrary query fields.
    const fragment = decodeURIComponent(input.hash.slice(1));
    if (fragment && fragment.length <= 400 && /^[\p{L}\p{N}_-]+$/u.test(fragment))
      target.hash = fragment;
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
