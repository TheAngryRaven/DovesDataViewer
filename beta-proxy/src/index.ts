/**
 * beta-proxy — a thin reverse-proxy Worker.
 *
 * Cloudflare custom domains cannot attach to a *Branch Preview* URL, so this
 * Worker owns beta.lapwingdata.com and transparently forwards every request to
 * the stable `beta` branch preview of the `lapwing` Worker.
 *
 * Change the deployment target by editing UPSTREAM_HOST below.
 */

// The stable Branch Preview hostname for the `beta` branch of `lapwing`.
// It's derived from the Worker name + account workers.dev subdomain, which are
// unchanged by the new public domain — so this stays on perchwerks.workers.dev.
const UPSTREAM_HOST = "beta-lapwing.perchwerks.workers.dev";

// The public hostname this proxy serves on (used to rewrite redirect targets so
// the preview host never leaks back to the client).
const PUBLIC_HOST = "beta.lapwingdata.com";

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Forward to the upstream preview host, preserving path + query string.
    url.hostname = UPSTREAM_HOST;
    url.protocol = "https:";
    url.port = "";

    // Reconstruct the request so all methods, headers, and the body are
    // forwarded verbatim. `redirect: "manual"` lets us rewrite Location
    // headers ourselves rather than letting fetch follow them.
    const upstreamRequest = new Request(url.toString(), request);

    const upstreamResponse = await fetch(upstreamRequest, { redirect: "manual" });

    // On 3xx redirects, swap the upstream .workers.dev host in the Location
    // header for our public host so clients never see the preview hostname.
    if (upstreamResponse.status >= 300 && upstreamResponse.status < 400) {
      const location = upstreamResponse.headers.get("Location");
      if (location) {
        const rewritten = rewriteLocation(location);
        if (rewritten !== location) {
          const headers = new Headers(upstreamResponse.headers);
          headers.set("Location", rewritten);
          return new Response(upstreamResponse.body, {
            status: upstreamResponse.status,
            statusText: upstreamResponse.statusText,
            headers,
          });
        }
      }
    }

    return upstreamResponse;
  },
} satisfies ExportedHandler;

/**
 * Rewrite a Location header value, replacing the upstream preview host with the
 * public host. Handles both absolute URLs and bare/relative values (which are
 * returned unchanged).
 */
function rewriteLocation(location: string): string {
  try {
    const target = new URL(location);
    if (target.hostname === UPSTREAM_HOST) {
      target.hostname = PUBLIC_HOST;
      return target.toString();
    }
    return location;
  } catch {
    // Relative Location (e.g. "/path") — nothing to rewrite.
    return location;
  }
}
