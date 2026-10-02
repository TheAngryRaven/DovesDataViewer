import { describe, expect, it, vi } from "vitest";
import { resumeInsta360Session, type Insta360DialogPhase, type ResumeSink } from "./resumeSession";
import type { Insta360CameraFile, Insta360CameraStatus } from "./types";

const camera = { cameraType: "X4", connectType: "wifi" as const };
const file = { id: "a", name: "VID_1.insv" } as Insta360CameraFile;
const connected: Insta360CameraStatus = { connected: true, camera };

function harness(initialPhase: Insta360DialogPhase = "idle") {
  let phase = initialPhase;
  const phases: Insta360DialogPhase[] = [];
  const sink: ResumeSink = {
    // Mirrors the dialog: only an idle dialog may resume.
    canResume: () => phase === "idle",
    setCamera: vi.fn(),
    setFiles: vi.fn(),
    setPhase: (p) => {
      phase = p;
      phases.push(p);
    },
  };
  return { sink, phases };
}

describe("resumeInsta360Session", () => {
  it("finishes at ready even though its own move to listing ends the idle state (regression)", async () => {
    const { sink, phases } = harness();
    await resumeInsta360Session({ status: async () => connected, listFiles: async () => [file] }, sink);
    expect(phases).toEqual(["listing", "ready"]);
    expect(sink.setFiles).toHaveBeenCalledWith([file]);
    expect(sink.setCamera).toHaveBeenCalledWith(camera);
  });

  it("drops back to idle when the listing fails instead of spinning", async () => {
    const { sink, phases } = harness();
    const listFiles = async (): Promise<Insta360CameraFile[]> => {
      throw new Error("gone");
    };
    await resumeInsta360Session({ status: async () => connected, listFiles }, sink);
    expect(phases).toEqual(["listing", "idle"]);
  });

  it("does nothing when no camera is connected", async () => {
    const { sink, phases } = harness();
    const listFiles = vi.fn();
    await resumeInsta360Session({ status: async () => ({ connected: false }), listFiles }, sink);
    expect(phases).toEqual([]);
    expect(listFiles).not.toHaveBeenCalled();
  });

  it("does nothing when the status call fails", async () => {
    const { sink, phases } = harness();
    const status = async (): Promise<Insta360CameraStatus> => {
      throw new Error("no shell");
    };
    await resumeInsta360Session({ status, listFiles: vi.fn() }, sink);
    expect(phases).toEqual([]);
  });

  it("leaves a user-started connect alone when the status answer arrives late", async () => {
    const { sink, phases } = harness("connecting");
    const listFiles = vi.fn();
    await resumeInsta360Session({ status: async () => connected, listFiles }, sink);
    expect(phases).toEqual([]);
    expect(sink.setCamera).not.toHaveBeenCalled();
    expect(listFiles).not.toHaveBeenCalled();
  });
});
