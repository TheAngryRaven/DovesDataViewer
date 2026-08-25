import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  deviceLocalClock,
  formatUtcOffset,
  localTimeZoneName,
  localUtcOffsetMinutes,
  offsetChoicesIncluding,
  parseUtcOffsetMinutes,
} from "@/lib/deviceTimezones";

interface DeviceTimezoneFieldProps {
  /** The raw `utc_offset_min` value as the device stores it: minutes east of UTC. */
  value: string;
  onChange: (next: string) => void;
}

/**
 * The `utc_offset_min` control: a list of real-world UTC offsets instead of a
 * number box, a one-tap shortcut to whatever this phone/laptop is set to, and
 * a running clock so a wrong pick is obvious before it is saved.
 *
 * The logger has no DST rules, so the shortcut deliberately uses the browser's
 * offset *right now* — in July that is the summer offset, which is the one the
 * driver wants on the device in July.
 */
export function DeviceTimezoneField({ value, onChange }: DeviceTimezoneFieldProps) {
  const { t } = useTranslation("drawer");
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const offsetMinutes = parseUtcOffsetMinutes(value);
  const choices = offsetChoicesIncluding(offsetMinutes);
  const browserOffset = localUtcOffsetMinutes(now);
  const zoneName = localTimeZoneName();

  return (
    <div className="flex-1 min-w-0 space-y-1.5">
      <Select
        value={offsetMinutes === null ? "" : String(offsetMinutes)}
        onValueChange={onChange}
      >
        <SelectTrigger className="h-9 w-full text-sm">
          {/* A device can hold an offset outside this list — an odd zone, or a
              hand-edited SETTINGS.json. Show it verbatim rather than blank. */}
          <SelectValue placeholder={value || undefined} />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {choices.map((choice) => (
            <SelectItem key={choice.minutes} value={String(choice.minutes)}>
              <span className="font-medium">{formatUtcOffset(choice.minutes)}</span>
              <span className="text-muted-foreground"> · {choice.places}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {browserOffset !== offsetMinutes && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
            onClick={() => onChange(String(browserOffset))}
          >
            <MapPin className="w-3.5 h-3.5" />
            {t("device.timezoneUseLocal")}
            <span className="opacity-70">
              ({zoneName ?? formatUtcOffset(browserOffset)})
            </span>
          </Button>
        )}
        {offsetMinutes !== null && (
          <span className="text-xs text-muted-foreground">
            {t("device.timezoneClock", { time: deviceLocalClock(now, offsetMinutes) })}
          </span>
        )}
      </div>
    </div>
  );
}
