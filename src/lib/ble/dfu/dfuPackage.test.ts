import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parseDfuPackage } from "./dfuPackage";

/** Build an in-memory DFU package zip mirroring `adafruit-nrfutil` output. */
async function buildPackage(opts?: {
  bin?: Uint8Array;
  dat?: Uint8Array;
  manifest?: unknown;
  omitBin?: boolean;
  omitManifest?: boolean;
}): Promise<ArrayBuffer> {
  const bin = opts?.bin ?? new Uint8Array([10, 20, 30, 40]);
  const dat = opts?.dat ?? new Uint8Array(14).fill(7);
  const manifest =
    opts?.manifest ??
    {
      manifest: {
        application: {
          bin_file: "BirdsEye.ino.bin",
          dat_file: "BirdsEye.ino.dat",
          init_packet_data: {
            application_version: 4294967295,
            device_revision: 65535,
            device_type: 82,
            firmware_crc16: 50892,
            softdevice_req: [291],
          },
        },
        dfu_version: 0.5,
      },
    };

  const zip = new JSZip();
  if (!opts?.omitManifest) zip.file("manifest.json", JSON.stringify(manifest));
  if (!opts?.omitBin) zip.file("BirdsEye.ino.bin", bin);
  zip.file("BirdsEye.ino.dat", dat);
  return zip.generateAsync({ type: "arraybuffer" });
}

describe("parseDfuPackage", () => {
  it("extracts image, init packet and metadata", async () => {
    const bin = new Uint8Array([1, 2, 3, 4, 5]);
    const dat = new Uint8Array(14).fill(9);
    const pkg = await parseDfuPackage(await buildPackage({ bin, dat }));

    expect(pkg.image).toEqual(bin);
    expect(pkg.initPacket).toEqual(dat);
    expect(pkg.meta).toMatchObject({
      binFile: "BirdsEye.ino.bin",
      datFile: "BirdsEye.ino.dat",
      dfuVersion: 0.5,
      deviceType: 82,
      firmwareCrc16: 50892,
      softdeviceReq: [291],
    });
  });

  it("accepts a Uint8Array as well as an ArrayBuffer", async () => {
    const buf = await buildPackage();
    const pkg = await parseDfuPackage(new Uint8Array(buf));
    expect(pkg.image.byteLength).toBeGreaterThan(0);
  });

  it("throws when manifest.json is missing", async () => {
    await expect(
      parseDfuPackage(await buildPackage({ omitManifest: true })),
    ).rejects.toThrow(/missing manifest\.json/);
  });

  it("throws when manifest.json is not valid JSON", async () => {
    const zip = new JSZip();
    zip.file("manifest.json", "{not json");
    zip.file("BirdsEye.ino.bin", new Uint8Array([1]));
    zip.file("BirdsEye.ino.dat", new Uint8Array(14));
    await expect(
      parseDfuPackage(await zip.generateAsync({ type: "arraybuffer" })),
    ).rejects.toThrow(/not valid JSON/);
  });

  it("throws when there is no application section", async () => {
    await expect(
      parseDfuPackage(await buildPackage({ manifest: { manifest: { dfu_version: 0.5 } } })),
    ).rejects.toThrow(/no 'application' section/);
  });

  it("throws when the referenced image file is absent", async () => {
    await expect(
      parseDfuPackage(await buildPackage({ omitBin: true })),
    ).rejects.toThrow(/missing image file/);
  });

  it("throws when the image is empty", async () => {
    await expect(
      parseDfuPackage(await buildPackage({ bin: new Uint8Array(0) })),
    ).rejects.toThrow(/image is empty/);
  });
});
