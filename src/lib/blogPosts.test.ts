import { describe, it, expect } from "vitest";
import {
  mapPostRow,
  slugify,
  deriveExcerpt,
  normalizeTags,
  collectTags,
  splitLatestByTag,
  WEB_UPDATE_TAG,
  type PostRow,
} from "./blogPosts";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("collapses punctuation runs into a single hyphen", () => {
    expect(slugify("LapWing 3.1: What's New?!")).toBe("lapwing-3-1-what-s-new");
  });

  it("strips diacritics", () => {
    expect(slugify("Café Sào Paulo — Übersicht")).toBe("cafe-sao-paulo-ubersicht");
  });

  it("trims leading/trailing separators", () => {
    expect(slugify("  --Hello--  ")).toBe("hello");
  });

  it("caps long titles at a hyphen boundary", () => {
    const slug = slugify("word ".repeat(40));
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith("-")).toBe(false);
    expect(slug.startsWith("word-word")).toBe(true);
  });

  it("hard-caps a single unbroken word", () => {
    expect(slugify("a".repeat(120))).toBe("a".repeat(80));
  });

  it("returns empty for unusable titles", () => {
    expect(slugify("!!! ???")).toBe("");
    expect(slugify("")).toBe("");
  });
});

describe("deriveExcerpt", () => {
  it("takes the first paragraph and skips a leading heading", () => {
    const md = "# Title\n\nFirst paragraph here.\n\nSecond paragraph.";
    expect(deriveExcerpt(md)).toBe("First paragraph here.");
  });

  it("joins wrapped lines of one paragraph", () => {
    expect(deriveExcerpt("line one\nline two\n\nnext")).toBe("line one line two");
  });

  it("strips images entirely but keeps link text", () => {
    const md = "See ![chart](https://x.test/a.png) the [docs](https://x.test) now.";
    expect(deriveExcerpt(md)).toBe("See the docs now.");
  });

  it("skips standalone images and code fences before the first paragraph", () => {
    const md = "![hero](https://x.test/hero.png)\n\n```js\ncode();\n```\n\nReal text.";
    expect(deriveExcerpt(md)).toBe("Real text.");
  });

  it("strips emphasis, bold, strikethrough, and inline code markers", () => {
    expect(deriveExcerpt("**Bold** and _italic_ and ~~gone~~ and `code`.")).toBe(
      "Bold and italic and gone and code.",
    );
  });

  it("stops the paragraph at a following heading", () => {
    expect(deriveExcerpt("Intro text.\n## Section\nMore.")).toBe("Intro text.");
  });

  it("truncates at a word boundary with an ellipsis", () => {
    const md = "alpha bravo charlie delta echo";
    expect(deriveExcerpt(md, 14)).toBe("alpha bravo…");
  });

  it("returns empty for an empty or heading-only body", () => {
    expect(deriveExcerpt("")).toBe("");
    expect(deriveExcerpt("# Only a title")).toBe("");
  });
});

describe("normalizeTags", () => {
  it("trims, lowercases, and collapses inner whitespace", () => {
    expect(normalizeTags(["  Race  Craft ", "GPS"])).toEqual(["race craft", "gps"]);
  });

  it("drops empties and dedupes preserving order", () => {
    expect(normalizeTags(["b", "", "A", "  ", "a", "B"])).toEqual(["b", "a"]);
  });
});

describe("collectTags", () => {
  it("unions and sorts tags across posts", () => {
    const posts = [{ tags: ["gps", "firmware"] }, { tags: ["app", "gps"] }];
    expect(collectTags(posts)).toEqual(["app", "firmware", "gps"]);
  });

  it("handles no posts", () => {
    expect(collectTags([])).toEqual([]);
  });
});

describe("splitLatestByTag", () => {
  const post = (slug: string, tags: string[]) => ({ slug, tags });

  it("picks the newest tagged and newest untagged post", () => {
    const posts = [
      post("newest-news", ["firmware"]),
      post("newest-web", [WEB_UPDATE_TAG, "release"]),
      post("older-web", [WEB_UPDATE_TAG]),
      post("older-news", []),
    ];
    const { tagged, untagged } = splitLatestByTag(posts, WEB_UPDATE_TAG);
    expect(tagged?.slug).toBe("newest-web");
    expect(untagged?.slug).toBe("newest-news");
  });

  it("returns null for a side with no matching post", () => {
    expect(splitLatestByTag([post("a", [WEB_UPDATE_TAG])], WEB_UPDATE_TAG)).toEqual({
      tagged: post("a", [WEB_UPDATE_TAG]),
      untagged: null,
    });
    expect(splitLatestByTag([post("b", ["news"])], WEB_UPDATE_TAG)).toEqual({
      tagged: null,
      untagged: post("b", ["news"]),
    });
    expect(splitLatestByTag([], WEB_UPDATE_TAG)).toEqual({ tagged: null, untagged: null });
  });
});

describe("mapPostRow", () => {
  const row: PostRow = {
    id: "id-1",
    slug: "hello-world",
    title: "Hello World",
    body: "Body text",
    tags: null,
    ai_assisted: true,
    published: false,
    published_at: null,
    author_id: "user-1",
    created_at: "2026-07-24T00:00:00Z",
    updated_at: "2026-07-24T01:00:00Z",
  };

  it("maps snake_case to camelCase and defaults null tags to []", () => {
    expect(mapPostRow(row)).toEqual({
      id: "id-1",
      slug: "hello-world",
      title: "Hello World",
      body: "Body text",
      tags: [],
      aiAssisted: true,
      published: false,
      publishedAt: null,
      authorId: "user-1",
      createdAt: "2026-07-24T00:00:00Z",
      updatedAt: "2026-07-24T01:00:00Z",
    });
  });

  it("keeps a populated tags array", () => {
    expect(mapPostRow({ ...row, tags: ["a", "b"] }).tags).toEqual(["a", "b"]);
  });
});
