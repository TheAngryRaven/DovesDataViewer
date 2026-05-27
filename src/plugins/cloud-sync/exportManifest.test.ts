import { describe, it, expect } from "vitest";
import { buildExportTextFiles, buildReadme, type CloudExport, type LocalExport } from "./exportManifest";

const localFixture: LocalExport = {
  settings: { useKph: true },
  stores: {
    karts: [{ id: "k1", name: "Kart" }],
    notes: [],
  },
  fileNames: ["session1.csv", "session2.ubx"],
};

describe("buildExportTextFiles", () => {
  it("includes local settings + one file per store, plus a README", () => {
    const files = buildExportTextFiles(null, localFixture);
    expect(Object.keys(files)).toContain("local/settings.json");
    expect(Object.keys(files)).toContain("local/stores/karts.json");
    expect(Object.keys(files)).toContain("local/stores/notes.json");
    expect(Object.keys(files)).toContain("README.txt");
    expect(JSON.parse(files["local/stores/karts.json"])).toEqual([{ id: "k1", name: "Kart" }]);
  });

  it("omits all cloud/* entries when signed out (no cloud export)", () => {
    const files = buildExportTextFiles(null, localFixture);
    expect(Object.keys(files).some((p) => p.startsWith("cloud/"))).toBe(false);
  });

  it("includes cloud entries when a cloud export is present", () => {
    const cloud: CloudExport = {
      account: { user_id: "u1", email: "a@b.com" },
      profile: { display_name: "Speedy" },
      subscription: { tier: "pro" },
      roles: ["user"],
      garage_records: [{ store: "notes", record_key: "n1", data: {} }],
      contact_messages: [{ category: "Bug Report", message: "hi" }],
      cloud_files: [{ name: "lap.csv" }],
    };
    const files = buildExportTextFiles(cloud, localFixture);
    expect(JSON.parse(files["cloud/profile.json"])).toEqual({ display_name: "Speedy" });
    expect(JSON.parse(files["cloud/roles.json"])).toEqual(["user"]);
    expect(JSON.parse(files["cloud/cloud-files-index.json"])).toEqual([{ name: "lap.csv" }]);
    // No pending deletion → that file is absent.
    expect(Object.keys(files)).not.toContain("cloud/pending-deletion.json");
  });

  it("adds a pending-deletion file only when one exists", () => {
    const cloud: CloudExport = { pending_deletion: { scheduled_for: "2026-06-01T00:00:00Z" } };
    const files = buildExportTextFiles(cloud, localFixture);
    expect(Object.keys(files)).toContain("cloud/pending-deletion.json");
  });
});

describe("buildReadme", () => {
  it("reports cloud + local file counts", () => {
    const readme = buildReadme({ cloud_files: [{ name: "a" }, { name: "b" }] }, localFixture);
    expect(readme).toContain("Cloud session files: 2");
    expect(readme).toContain("Local session files: 2");
  });

  it("treats a null cloud export as zero cloud files", () => {
    const readme = buildReadme(null, localFixture);
    expect(readme).toContain("Cloud session files: 0");
  });
});
