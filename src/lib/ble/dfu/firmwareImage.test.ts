import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { acquireFirmwareImage } from "./firmwareImage";
import { crc32Hex } from "../firmwareCrc";
import type { FirmwareBuild } from "./dfuTypes";

const IMAGE = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const IMAGE_CRC = crc32Hex(IMAGE);

function makeBuild(overrides?: Partial<FirmwareBuild>): FirmwareBuild {
  return {
    name: "BirdsEye-sense",
    variant: "sense",
    dfuZip: "https://example.test/fw.zip",
    appBin: "https://example.test/fw.bin",
    appCrc32: IMAGE_CRC,
    appSize: IMAGE.byteLength,
    ...overrides,
  };
}

/** A FetchLike serving fixed bytes per URL, recording what was requested. */
function makeFetch(routes: Record<string, ArrayBuffer | Uint8Array>) {
  const requested: string[] = [];
  const fetchImpl = async (url: string) => {
    requested.push(url);
    const body = routes[url];
    if (!body) return new Response(null, { status: 404 });
    const buf = body instanceof Uint8Array
      ? body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
      : body;
    return new Response(buf, { status: 200 });
  };
  return { fetchImpl, requested };
}

async function buildDfuZip(bin: Uint8Array): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    "manifest.json",
    JSON.stringify({
      manifest: {
        application: { bin_file: "app.bin", dat_file: "app.dat" },
        dfu_version: 0.5,
      },
    }),
  );
  zip.file("app.bin", bin);
  zip.file("app.dat", new Uint8Array(14).fill(7));
  return zip.generateAsync({ type: "arraybuffer" });
}

describe("acquireFirmwareImage", () => {
  it("prefers the raw appBin and verifies size + CRC against the manifest", async () => {
    const build = makeBuild();
    const { fetchImpl, requested } = makeFetch({ [build.appBin!]: IMAGE });

    const acquired = await acquireFirmwareImage(build, fetchImpl);

    expect(requested).toEqual([build.appBin]);
    expect(acquired.image).toEqual(IMAGE);
    expect(acquired.crc).toBe(IMAGE_CRC);
  });

  it("falls back to unzipping the dfuZip when appBin is absent", async () => {
    const build = makeBuild({ appBin: undefined });
    const { fetchImpl, requested } = makeFetch({ [build.dfuZip]: await buildDfuZip(IMAGE) });

    const acquired = await acquireFirmwareImage(build, fetchImpl);

    expect(requested).toEqual([build.dfuZip]);
    expect(acquired.image).toEqual(IMAGE);
    expect(acquired.crc).toBe(IMAGE_CRC);
  });

  it("throws on a size mismatch with the manifest", async () => {
    const build = makeBuild({ appSize: IMAGE.byteLength + 1 });
    const { fetchImpl } = makeFetch({ [build.appBin!]: IMAGE });

    await expect(acquireFirmwareImage(build, fetchImpl)).rejects.toThrow(/bytes/);
  });

  it("throws on a CRC mismatch with the manifest", async () => {
    const build = makeBuild({ appCrc32: "deadbeef" });
    const { fetchImpl } = makeFetch({ [build.appBin!]: IMAGE });

    await expect(acquireFirmwareImage(build, fetchImpl)).rejects.toThrow(/CRC/);
  });

  it("propagates a failed download", async () => {
    const build = makeBuild();
    const { fetchImpl } = makeFetch({});

    await expect(acquireFirmwareImage(build, fetchImpl)).rejects.toThrow(/HTTP 404/);
  });
});
