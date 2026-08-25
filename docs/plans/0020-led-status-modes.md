# 0020 — Status-LED modes, unit-aware device settings

Pairs with logger **plan 0012**, which made the strip's two status LEDs
user-assignable and renamed `rev_limit` to `target_rpm`. This is the UI that
assigns them.

## Why this plan exists twice

The work first landed as PR #415 — based on `main`, which was the wrong branch:
this repo promotes BETA → main, so an unreleased feature went straight to
production and never reached beta.lapwingdata.com, the very channel the
firmware was being tested against. The visible symptom was the one this plan
fixes: a beta logger reporting `led_status_left` to an app whose schema had
never heard of it, so `getSettingDef()` returned `null` and the row fell
through to the unknown-key path — raw key as the label, no description, a
free-text box instead of the dropdown, and `validateSettingValue()`
early-returning `null` so a typo saved straight to the device.

#415 was reverted from `main` (#416) and re-landed here, reconciled with plan
0018 rather than merged.

**It could not be merged.** `git merge-tree` flags four conflicting files, but
the dangerous part is not among them: `DEVICE_SETTINGS_SCHEMA` is an array, so
both lineages' entries merge *textually clean* and leave **ten duplicated keys**
(`utc_offset_min`, `temp1_alert_c`, `tach_filter`, `rev_limit`,
`overrev_limit`, the three `led_*` hour/brightness keys, `led_brightness`,
`camera_serial`). `getSettingDef()` is a `.find()`, so the first duplicate
silently wins and the second becomes dead config — it compiles, it ships, and
it picks e.g. the timezone picker *or* a raw number box by line order. The
`has unique keys` test is what would catch it; keep that test.

Plan 0018's model won everywhere the two overlapped: `group` over `advanced`,
`allowZero` over `zeroDisables`, the timezone picker over a raw offset box.
Only three things travelled.

## What travelled

**The four keys plan 0018 predates**, all `group: 'leds'`:
`led_status_left`, `led_status_right` (both `helpTopic: 'ledStatusModes'`),
`target_rpm`, and `target_speed_mph`.

`rev_limit` stays alongside `target_rpm` with the **same** `'Target RPM'`
label. The tab renders only keys the device reports, so exactly one of the two
ever appears — a pre-4.1.0 logger sends `rev_limit`, a 4.1.0+ one `target_rpm` — and
either way the field reads the same.

**`requiresKey` on an option**, with `availableOptions()`. EGT is compiled out
of a stock logger, where the mode renders as a dark LED, so it is offered only
on devices that also report `temp1_alert_c` — which ships on exactly those
builds, making its presence the capability signal. A value the device is
**already** storing is never hidden, or the select could not display the
setting the user actually has.

**The unit system** — `unit`, `UnitPrefs`, `needsUnitConversion()`,
`settingUnitLabel()`, `toDisplayUnits()`, `fromDisplayUnits()`. Device settings
were entirely unit-blind before this: the firmware stores mph and Celsius, and
the tab showed the raw integer whatever the app's toggles said.

Two rules make it safe:

- **Rows stay in device units end to end.** Only the input box converts, so
  `validateSettingValue()` enforces the firmware's own clamp rather than a
  rounded copy of it, and the value written by `SSET` is the one the firmware
  will accept.
- **The two units sit on opposite sides of the imperial/metric line.** The
  device stores speed in mph (imperial) and temperature in Celsius (metric), so
  `needsUnitConversion` is `useKph` for one and `!useMetricWeather` for the
  other. That asymmetry looks like a bug and is not — it is why the function
  exists as a named predicate with the reason written above it, and why the
  round-trip test sweeps every in-range value. On the first attempt the polarity
  was backwards and the sweep is what caught it.

Round-tripping integers through two roundings can move a value by one device
unit; that is inherent, and one mph on a target speed is under the thing's own
resolution. The test pins that it never drifts *further*, so repeatedly opening
and saving an untouched field cannot walk the value.

**`LedModeHelpDialog`** — eight modes with up to five colour states apiece is
too much for a description line, and Radix tooltips do not open reliably on
touch, which is most of this audience. So it is a `Dialog`, opened from a
`HelpCircle` beside the label wherever `helpTopic` is set. The colour chips are
literal LED colours, not theme tokens: they exist to match what the strip
actually shows, so they must not follow light/dark mode.

## Two edits to existing entries

- `temp1_alert_c` gains `unit: 'tempC'` and drops the hardcoded `(°C)` from its
  label — the field now prints the live unit, and a label saying °C beside a
  box showing °F would be worse than no label at all.
- `rev_limit` is relabelled from `'Rev Limit (RPM)'` to `'Target RPM'`, matching
  the firmware rename. It always was the shift point; `overrev_limit` is the
  real limit.
