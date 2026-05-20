import { useEffect } from "react";

interface DocumentHeadOptions {
  title: string;
  description?: string;
  canonical?: string;
}

/**
 * Lightweight per-route head manager. Sets <title>, meta description,
 * canonical link, and matching og:/twitter: social tags, then restores
 * them on unmount so other routes fall back to the static defaults in
 * index.html.
 */
export function useDocumentHead({ title, description, canonical }: DocumentHeadOptions): void {
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

    return () => {
      document.title = prevTitle;
      restorers.forEach((r) => r());
    };
  }, [title, description, canonical]);
}
