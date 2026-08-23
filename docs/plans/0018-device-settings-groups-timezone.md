# Device settings: a timezone picker and collapsible groups

> Status: **DONE**. Firmware side is
> `DovesDataLogger/docs/plans/0010-local-timezone-led-day-night.md` (shipped in
> logger **4.1.0**), plus `0006-neopixel-strip.md` and `0007-led-rev-temp-alerts.md`.
> Nothing here changes the BLE protocol — every key below already travels over
> the existing `SLIST` / `SSET` verbs.

## Why this exists

Logger 4.1.0 ships four new settings keys (`utc_offset_min`,
`led_brightness_night`, `led_day_start_hour`, `led_night_start_hour`) and, since
the NeoPixel strip now builds into *every* image, four more that were previously
beta-only in practice (`led_brightness`, `rev_limit`, `overrev_limit`,
`temp1_alert_c`). `tach_filter` and `camera_serial` had also never been added.

`DEVICE_SETTINGS_SCHEMA` knew none of them, and the Device tab's rule for an
unknown key is *render it as a raw text box with no validation*. That rule is
right — it is what keeps this app usable against a firmware newer than itself —
but on a key we *do* know about it produces two bad outcomes:

1. **No range checking.** The firmware silently keeps its compiled-in default
   for an out-of-band value (`setting_parse::parseIntSetting` + a range test),
   so a typo'd `rev_limit` reads to the user as the setting not working.
2. **`utc_offset_min` asks for minutes east of UTC.** Nobody knows that US
   Central is `-360`, and the two offsets that half the planet lives on are
   `-360`/`-300` depending on the month.

Meanwhile the tab had exactly two tiers — main list and "Advanced" — so eight
new keys would have doubled the length of the scroll a driver reads to change
their name.

## What was built

**`lib/deviceTimezones.ts`** — a pure unit: the offset choices, the
parse/format/validate helpers, and the clock preview. Offsets, *not* IANA zones,
because the device stores one number and has no DST rules; a region that
observes DST therefore appears at two offsets, tagged winter and summer.

Three details worth keeping:

- **Minutes, mirroring the firmware.** The list carries `+05:30`, `+05:45`,
  `-03:30`, `+12:45`. An hours-only picker is wrong for real places, and the
  firmware's `local_time` unit already takes minutes for exactly that reason.
- **"Use this device's timezone" reads the browser's offset *right now*,**
  DST included. Setting the logger in July should put July's offset on it,
  because the logger will not move to winter time on its own in November. The
  field's description says so.
- **An offset the list doesn't have is spliced in, not dropped.** A device can
  hold anything (a hand-edited `SETTINGS.json`); a select that quietly omitted
  the current value would rewrite the user's setting on their next save.

**Grouping.** `DeviceSettingDef.advanced?: boolean` became
`group?: DeviceSettingGroupId`, with `advanced` as one group among others and
`isAdvancedSetting()` kept as a thin read of it. `groupSettingRows()` is pure
and splits rows into the main list plus one bucket per group, preserving schema
order inside each and **dropping empty groups** — a firmware built without
`BIRDSEYE_ENABLE_NEOPIXEL` sends no LED keys and gets no LED section.

**The LED section** carries brightness (day + night), the two day/night start
hours, and the rev/over-rev/temperature alert thresholds — everything whose only
consumer is the strip. `utc_offset_min` deliberately stays in the **main list**:
its only consumer today is the LED swap, but a driver looking for "timezone"
should not have to guess it is filed under lights.

**Hours are an enum, not a number box.** `localHourOptions()` generates the 24
choices as `{ value: "19", label: "7:00 PM" }`, so the existing enum renderer
and enum validation do the work and `19` never has to be read as a bare integer.

## Traps

1. **`led_brightness` 0 is a real, destructive value** — it cuts the strip's
   5 V rail, where `led_brightness_night` 0 only blanks the frame. Both validate
   as in-band; the descriptions carry the difference.
2. **`overrev_limit` is 0 *or* 1000-20000.** The firmware special-cases the
   disable sentinel below its own floor, so the schema grew `allowZero` rather
   than a `min: 0` that would have let `500` through as valid.
3. **An empty numeric box used to validate as 0.** `Number("")` is 0 and it is
   an integer, so the old validator only caught it where 0 was out of range —
   `bluetooth_pin` (min 0) and now `led_brightness` (min 0) sailed through and
   wrote an empty string to the device. Empty is now "Must be a whole number",
   which is also what the firmware's parser answers.
4. **Group titles translate; setting labels don't.** The schema's labels and
   descriptions are English data (see `docs/i18n.md`), but the section chrome is
   UI, so it goes through `drawer.device.*` like the rest of the tab.

## Non-goals

- **No DST on the app side either.** The app could compute the device's next
  transition and re-push the offset on connect, but a setting that changes
  itself behind the user's back is worse than one that needs re-picking twice a
  year — and the device would still be wrong for the weeks between connections.
- **No viewing-timezone preference for logs.** Logger plan 0010 lists that as a
  follow-up; it is a `SettingsContext`/presentation change with nothing to do
  with the device, and lumping it in here would have hidden it inside a Device
  tab PR.
