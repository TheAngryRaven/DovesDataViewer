/**
 * Unit tests for contact-message payload building (plan 0013 follow-up).
 */

import { describe, it, expect } from "vitest";
import { buildContactBody } from "./contactMessage";
import { MAX_UPLOAD_BYTES } from "./parseReport";

describe("buildContactBody", () => {
  it("keeps the original JSON contract when no attachment is present", async () => {
    const built = await buildContactBody({
      category: "Bug Report",
      message: "  hello  ",
      email: " user@example.com ",
    });
    expect(built).not.toBe("too-large");
    const { body, contentType } = built as { body: string; contentType?: string };
    expect(contentType).toBe("application/json");
    expect(JSON.parse(body)).toEqual({
      category: "Bug Report",
      email: "user@example.com",
      message: "hello",
    });
  });

  it("sends null email in the JSON path when omitted", async () => {
    const built = (await buildContactBody({ category: "Comment", message: "m" })) as { body: string };
    expect(JSON.parse(built.body).email).toBeNull();
  });

  it("switches to multipart when a session file is attached", async () => {
    const content = "Lap;Time;Speed GPS\n".repeat(1000);
    const built = await buildContactBody({
      category: "Bug Report",
      message: "laps look wrong",
      attachment: { blob: new Blob([content]), name: "session_10-5788.csv" },
    });
    expect(built).not.toBe("too-large");
    const { body, contentType } = built as { body: FormData; contentType?: string };
    expect(contentType).toBeUndefined(); // browser sets the multipart boundary
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("category")).toBe("Bug Report");
    expect(body.get("message")).toBe("laps look wrong");
    expect(body.get("fileName")).toBe("session_10-5788.csv");
    expect(Number(body.get("fileSize"))).toBe(content.length);
    // Repetitive CSV compresses, so the upload rides gzipped
    expect(body.get("compression")).toBe("gzip");
    expect((body.get("file") as File).name).toBe("session_10-5788.csv.gz");
    expect((body.get("file") as File).size).toBeLessThan(content.length);
  });

  it("rejects attachments over the upload ceiling", async () => {
    const bytes = new Uint8Array(MAX_UPLOAD_BYTES + 1024 * 1024);
    let s = 0x9e3779b9;
    for (let i = 0; i < bytes.length; i++) {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      bytes[i] = s & 0xff;
    }
    const built = await buildContactBody({
      category: "Comment",
      message: "m",
      attachment: { blob: new Blob([bytes]), name: "huge.xrk" },
    });
    expect(built).toBe("too-large");
  });

  it("carries the session's track bundle as a second, track-prefixed attachment", async () => {
    const trackJson = JSON.stringify({ kind: "lapwing-support-track", track: { name: "Test Raceway" } });
    const built = await buildContactBody({
      category: "Bug Report",
      message: "sector 2 never triggers",
      attachment: { blob: new Blob(["t,lat,lon\n"]), name: "run.dovex" },
      trackAttachment: { blob: new Blob([trackJson]), name: "run.track.json" },
    });
    const { body } = built as { body: FormData };
    expect(body.get("fileName")).toBe("run.dovex");
    expect(body.get("trackFileName")).toBe("run.track.json");
    expect(Number(body.get("trackFileSize"))).toBe(trackJson.length);
    expect((body.get("trackFile") as File).size).toBeGreaterThan(0);
    // The two groups stay independent — neither overwrites the other.
    expect((body.get("file") as File).name).toMatch(/^run\.dovex/);
    expect((body.get("trackFile") as File).name).toMatch(/^run\.track\.json/);
  });

  it("goes multipart for a track bundle even without a datalog", async () => {
    const built = await buildContactBody({
      category: "Comment",
      message: "just the track",
      trackAttachment: { blob: new Blob(["{}"]), name: "run.track.json" },
    });
    const { body, contentType } = built as { body: FormData; contentType?: string };
    expect(contentType).toBeUndefined();
    expect(body.get("trackFileName")).toBe("run.track.json");
    expect(body.get("file")).toBeNull();
  });
});
