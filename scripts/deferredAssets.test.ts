import { describe, it, expect } from "vitest";
import { DEFERRED_ASSET_DIRS, deferredAssetPathPattern, sameOriginPathMatcher } from "./deferredAssets";

const at = (path: string) => new URL(path, "https://lapwingdata.com");

describe("deferredAssetPathPattern", () => {
  it("derives the route test from the directory list", () => {
    const re = deferredAssetPathPattern(DEFERRED_ASSET_DIRS);
    expect(re.source).toBe("^\\/(?:samples|loggers)\\/");
    for (const dir of DEFERRED_ASSET_DIRS) expect(re.test(`/${dir}/file.bin`)).toBe(true);
  });

  it("matches only whole top-level directories", () => {
    const re = deferredAssetPathPattern(DEFERRED_ASSET_DIRS);
    expect(re.test("/samplesX/file")).toBe(false);
    expect(re.test("/s/samples/file")).toBe(false);
    expect(re.test("/samples")).toBe(false);
  });

  it("escapes regex metacharacters in directory names", () => {
    const re = deferredAssetPathPattern(["a.b"]);
    expect(re.test("/a.b/x")).toBe(true);
    expect(re.test("/aXb/x")).toBe(false);
  });
});

describe("sameOriginPathMatcher", () => {
  const matcher = sameOriginPathMatcher(deferredAssetPathPattern(DEFERRED_ASSET_DIRS));

  it("matches same-origin deferred paths only", () => {
    expect(matcher({ url: at("/loggers/fledgling.webp"), sameOrigin: true })).toBe(true);
    expect(matcher({ url: at("/loggers/fledgling.webp"), sameOrigin: false })).toBe(false);
    expect(matcher({ url: at("/index.html"), sameOrigin: true })).toBe(false);
  });

  it("keeps working after the toString round-trip workbox-build does", () => {
    // The worker gets the function's source text, not the closure.
    const revived = new Function(`return (${matcher.toString()});`)() as typeof matcher;
    expect(revived({ url: at("/samples/okc.dovex"), sameOrigin: true })).toBe(true);
    expect(revived({ url: at("/sim/birdseye-sim.mjs"), sameOrigin: true })).toBe(false);
  });
});
