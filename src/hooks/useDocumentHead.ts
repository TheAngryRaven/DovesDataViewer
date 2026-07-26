import { useEffect } from "react";

interface DocumentHeadOptions {
  title: string;
  description?: string;
  canonical?: string;
  /** og:type override (index.html default is "website"), e.g. "article". */
  ogType?: string;
  /** ISO timestamp for article:published_time (articles only). */
  publishedTime?: string;
  /** ISO timestamp for article:modified_time (articles only). */
  modifiedTime?: string;
  /** Structured data injected as a JSON-LD script, removed on unmount. */
  jsonLd?: Record<string, unknown>;
  /** RSS autodiscovery: <link rel="alternate" type="application/rss+xml">. */
  feedUrl?: string;
  /**
   * `<meta name="robots">` override, e.g. "noindex". A static-hosted SPA can't
   * return a real 404 status, so a not-found route says so here instead of
   * letting crawlers index a soft 404.
   */
  robots?: string;
}

/**
 * Lightweight per-route head manager. Sets <title>, meta description,
 * canonical link, and matching og:/twitter: social tags, then restores
 * them on unmount so other routes fall back to the static defaults in
 * index.html.
 */
export function useDocumentHead({
  title,
  description,
  canonical,
  ogType,
  publishedTime,
  modifiedTime,
  jsonLd,
  feedUrl,
  robots,
}: DocumentHeadOptions): void {
  // Depend on the serialized form so callers can pass an inline object literal
  // without re-running the effect every render.
  const jsonLdText = jsonLd ? JSON.stringify(jsonLd) : undefined;

  useEffect(() => {
    const prevTitle = document.title;
    document.title = title;

    const upsert = (
      selector: string,
      create: () => HTMLElement,
      attr: "content" | "href",
      value: string,
    ) => {
      let el = document.head.querySelector<HTMLElement>(selector);
      const created = !el;
      if (!el) {
        el = create();
        document.head.appendChild(el);
      }
      const prev = el.getAttribute(attr);
      el.setAttribute(attr, value);
      return () => {
        if (created) el?.remove();
        else if (prev !== null) el?.setAttribute(attr, prev);
      };
    };

    const metaName = (name: string, value: string) =>
      upsert(
        `meta[name="${name}"]`,
        () => {
          const m = document.createElement("meta");
          m.setAttribute("name", name);
          return m;
        },
        "content",
        value,
      );

    const metaProp = (prop: string, value: string) =>
      upsert(
        `meta[property="${prop}"]`,
        () => {
          const m = document.createElement("meta");
          m.setAttribute("property", prop);
          return m;
        },
        "content",
        value,
      );

    const restorers: Array<() => void> = [];

    // Social title mirrors document title
    restorers.push(metaProp("og:title", title));
    restorers.push(metaName("twitter:title", title));

    if (description) {
      restorers.push(
        upsert(
          'meta[name="description"]',
          () => {
            const m = document.createElement("meta");
            m.setAttribute("name", "description");
            return m;
          },
          "content",
          description,
        ),
      );
      restorers.push(metaProp("og:description", description));
      restorers.push(metaName("twitter:description", description));
    }
    if (canonical) {
      restorers.push(
        upsert(
          'link[rel="canonical"]',
          () => {
            const l = document.createElement("link");
            l.setAttribute("rel", "canonical");
            return l;
          },
          "href",
          canonical,
        ),
      );
      restorers.push(metaProp("og:url", canonical));
    }
    if (ogType) {
      restorers.push(metaProp("og:type", ogType));
    }
    if (robots) {
      restorers.push(metaName("robots", robots));
    }
    if (publishedTime) {
      restorers.push(metaProp("article:published_time", publishedTime));
    }
    if (modifiedTime) {
      restorers.push(metaProp("article:modified_time", modifiedTime));
    }
    if (jsonLdText) {
      const script = document.createElement("script");
      script.type = "application/ld+json";
      script.text = jsonLdText;
      document.head.appendChild(script);
      restorers.push(() => script.remove());
    }
    if (feedUrl) {
      const link = document.createElement("link");
      link.rel = "alternate";
      link.type = "application/rss+xml";
      link.title = title;
      link.href = feedUrl;
      document.head.appendChild(link);
      restorers.push(() => link.remove());
    }

    return () => {
      document.title = prevTitle;
      restorers.forEach((r) => r());
    };
  }, [title, description, canonical, ogType, publishedTime, modifiedTime, jsonLdText, feedUrl, robots]);
}
