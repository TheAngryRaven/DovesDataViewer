// Chassis calibration editor (plan 0011), built around the profile system:
// pick a built-in brand profile (all estimated until someone measures one),
// turn paddock measurements into constants with the helpers, and freeze the
// result as a named "measured" profile for reuse. Any hand edit detaches the
// active profile.

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToolsT } from "../i18n";
import { NumRow } from "../shared/NumRow";
import {
  eccentricityFromSweep,
  neutralFromMeasured,
  PILL_SIZES,
  type PillCalibration,
  type PillSize,
} from "./model";
import { BUILTIN_PROFILES, findProfile, type ChassisProfile } from "./profiles";

interface CalibrationPanelProps {
  cal: PillCalibration;
  profileId: string | null;
  userProfiles: ChassisProfile[];
  onChange: (cal: PillCalibration, profileId: string | null) => void;
  onSaveProfile: (name: string) => void;
  onDeleteProfile: (id: string) => void;
}

export function CalibrationPanel({
  cal,
  profileId,
  userProfiles,
  onChange,
  onSaveProfile,
  onDeleteProfile,
}: CalibrationPanelProps) {
  const t = useToolsT();
  const [profileName, setProfileName] = useState("");
  const [sweepMm, setSweepMm] = useState(0);
  const [sweepSize, setSweepSize] = useState<PillSize>(3);
  const [zeroCamber, setZeroCamber] = useState(0);
  const [zeroCaster, setZeroCaster] = useState(0);

  const edit = (patch: Partial<PillCalibration>) => onChange({ ...cal, ...patch }, null);
  const editE = (i: number, v: number) => {
    const eMm = [...cal.eMm] as PillCalibration["eMm"];
    eMm[i] = Math.max(v, 0);
    edit({ eMm });
  };

  const activeProfile = findProfile(profileId, userProfiles);
  const isUserProfile = activeProfile !== null && userProfiles.some((p) => p.id === activeProfile.id);
  const sourceLabel = (p: ChassisProfile) =>
    p.source === "measured" ? t("pill.cal.measured") : t("pill.cal.estimated");

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-muted-foreground">{t("pill.cal.disclaimer")}</p>

      {/* Profile picker + lifecycle */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label className="text-xs text-muted-foreground">{t("pill.cal.profile")}</Label>
          <Select
            value={profileId ?? "custom"}
            onValueChange={(id) => {
              const profile = findProfile(id, userProfiles);
              if (profile) onChange({ ...profile.cal, eMm: [...profile.cal.eMm] }, profile.id);
            }}
          >
            <SelectTrigger className="h-8 w-56 mt-1 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {userProfiles.length > 0 && (
                <SelectGroup>
                  <SelectLabel>{t("pill.cal.userProfiles")}</SelectLabel>
                  {userProfiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} · {sourceLabel(p)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              <SelectGroup>
                <SelectLabel>{t("pill.cal.builtinProfiles")}</SelectLabel>
                {BUILTIN_PROFILES.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} · {sourceLabel(p)}
                  </SelectItem>
                ))}
              </SelectGroup>
              {profileId === null && (
                <SelectItem value="custom" disabled>
                  {t("pill.cal.profileCustom")}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
        {isUserProfile && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-destructive"
            onClick={() => onDeleteProfile(activeProfile.id)}
          >
            <Trash2 className="w-3.5 h-3.5" /> {t("pill.cal.deleteProfile")}
          </Button>
        )}
      </div>

      {/* Freeze the current constants as a named measured profile */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0">
          <Label className="text-xs text-muted-foreground">{t("pill.cal.profileName")}</Label>
          <Input
            className="h-8 mt-1 w-56 text-sm"
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
            placeholder={t("pill.cal.profileNamePlaceholder")}
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          disabled={profileName.trim().length === 0}
          onClick={() => {
            onSaveProfile(profileName);
            setProfileName("");
          }}
        >
          {t("pill.cal.saveProfile")}
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <NumRow label={t("pill.cal.h")} unit="mm" value={cal.hMm} onChange={(v) => edit({ hMm: Math.max(v, 10) })} />
        <NumRow label={t("pill.cal.lRim")} unit="mm" value={cal.lRimMm} onChange={(v) => edit({ lRimMm: Math.max(v, 10) })} step={5} />
        <NumRow label={t("pill.cal.split")} unit="0–1" value={cal.wheelFrac} onChange={(v) => edit({ wheelFrac: Math.min(Math.max(v, 0), 1) })} step={0.05} />
        <NumRow label={t("pill.cal.neutralX")} unit="mm" value={cal.nXMm} onChange={(v) => edit({ nXMm: v })} step={0.1} />
        <NumRow label={t("pill.cal.neutralY")} unit="mm" value={cal.nYMm} onChange={(v) => edit({ nYMm: v })} step={0.1} />
        <NumRow label={t("pill.cal.gamma0")} unit="°" value={cal.gamma0Deg} onChange={(v) => edit({ gamma0Deg: v })} step={0.1} />
        <NumRow label={t("pill.cal.holeCount")} value={cal.holeCount} onChange={(v) => edit({ holeCount: Math.max(Math.round(v), 0) })} />
        <NumRow label={t("pill.cal.toeCoupling")} unit="mm/mm" value={cal.toeCouplingMmPerMm} onChange={(v) => edit({ toeCouplingMmPerMm: v })} step={0.1} />
      </div>

      <div>
        <Label className="text-xs text-muted-foreground">{t("pill.cal.eccentricity")}</Label>
        <div className="mt-1 grid grid-cols-3 sm:grid-cols-6 gap-3">
          {cal.eMm.map((e, i) => (
            <NumRow
              key={i}
              label={`e${i}`}
              unit="mm"
              value={e}
              step={0.1}
              onChange={(v) => editE(i, v)}
              // e0 is concentric by definition; editing it would break the solver's degenerate cases.
              className={i === 0 ? "pointer-events-none opacity-50" : undefined}
            />
          ))}
        </div>
      </div>

      {/* Measurement helpers — turn paddock readings into constants */}
      <div className="rounded-lg border border-border p-3 space-y-3">
        <p className="text-xs font-medium text-foreground">{t("pill.cal.measureTitle")}</p>
        <div className="flex flex-wrap items-end gap-2">
          <NumRow label={t("pill.cal.sweep")} unit="mm" step={0.1} value={sweepMm} onChange={setSweepMm} />
          <div>
            <Label className="text-xs text-muted-foreground">{t("pill.cal.sweepSize")}</Label>
            <Select value={String(sweepSize)} onValueChange={(v) => setSweepSize(Number(v) as PillSize)}>
              <SelectTrigger className="h-8 w-16 mt-1 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PILL_SIZES.filter((s) => s > 0).map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            disabled={sweepMm <= 0}
            onClick={() => editE(sweepSize, eccentricityFromSweep(sweepMm))}
          >
            {t("pill.cal.applySweep")}
          </Button>
        </div>
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground">{t("pill.cal.zeroIntro")}</p>
          <div className="flex flex-wrap items-end gap-2">
            <NumRow label={t("pill.cal.zeroCamber")} unit="°" step={0.1} value={zeroCamber} onChange={setZeroCamber} />
            <NumRow label={t("pill.cal.zeroCaster")} unit="°" step={0.1} value={zeroCaster} onChange={setZeroCaster} />
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => edit({ ...neutralFromMeasured(cal, zeroCamber, zeroCaster), gamma0Deg: 0 })}
            >
              {t("pill.cal.applyZero")}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={cal.signCamber === -1} onCheckedChange={(v) => edit({ signCamber: v ? -1 : 1 })} />
          {t("pill.cal.signCamber")}
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={cal.signCaster === -1} onCheckedChange={(v) => edit({ signCaster: v ? -1 : 1 })} />
          {t("pill.cal.signCaster")}
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={cal.mirrorRight} onCheckedChange={(v) => edit({ mirrorRight: v })} />
          {t("pill.cal.mirrorRight")}
        </label>
      </div>
    </div>
  );
}
