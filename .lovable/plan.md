

# Add MoTeC Data Import Support

## Overview
Add parsers for MoTeC's two main data formats: the CSV export from i2 Pro (easy, text-based) and the native `.ld` binary format (more complex, but commonly shared). MoTeC makes professional data loggers used across motorsport -- their i2 analysis software is free, making CSV export accessible to anyone.

## What MoTeC Is
MoTeC is an Australian company that makes high-end data acquisition systems (data loggers, ECUs, displays) used in professional and amateur motorsport. Their free i2 Standard/Pro software is the gold standard for telemetry analysis. Many sim racing platforms (Assetto Corsa, iRacing) also output MoTeC-compatible files.

## Format Details

### MoTeC CSV (Primary Target)
Exported from i2 Pro, this is a quoted-CSV with a structured header block:

```text
"Driver","John Doe",,,"Engine ID","4A-GE"
"Device","C125"
"Log Date","03/06/2012",,,"Origin Time","0.000","s"
"Log Time","0:00:01 AM",,,"Start Time","0.000","s"
"Sample Rate","20","Hz",,"End Time","529.6","s"
"Duration","529.6","s",,"Start Distance","0","m"
"Beacon Markers","156.295 69.125 69.226 66.130"
"Time","Ground Speed","Engine RPM","GPS Latitude","GPS Longitude"
"s","km/h","rpm","deg","deg"
"0","45.2","8500","35.123456","-97.654321"
```

Key characteristics:
- Every field is double-quoted (required by MoTeC)
- Header block with metadata (Driver, Device, Sample Rate, Beacon Markers, etc.)
- Beacon Markers are lap times in seconds, space-separated
- Channel names row followed by units row, then data
- Common channels: Ground Speed, GPS Latitude, GPS Longitude, Engine RPM, G Force Lat, G Force Long, GPS Heading

### MoTeC `.ld` Binary (Secondary Target)
Native binary format with:
- Fixed header at offset 0 (marker, channel pointers, event pointer, device info, date/time, driver, vehicle, venue)
- Linked-list of channel metadata (name, unit, data type, sample rate, data pointer)
- Channel data stored as int16/int32/float32 arrays
- Each channel can have its own sample rate (needs resampling to align)

## Changes

### 1. New File: `src/lib/motecParser.ts`
- `isMotecCsvFormat(text)` -- detect by checking for quoted fields with MoTeC header patterns ("Driver", "Device", "Sample Rate", "Beacon Markers", "Log Date")
- `parseMotecCsvFile(text)` -- parse the header block for metadata, find channel/unit rows, map GPS columns (GPS Latitude, GPS Longitude, Ground Speed, GPS Heading, etc.), map extra channels (RPM, G Force, temps), build GpsSample[] with standard normalization
- `isMotecLdFormat(buffer)` -- check for the LD marker bytes at offset 0
- `parseMotecLdFile(buffer)` -- port the binary parsing logic using DataView (no external dependencies needed): read header, walk the channel linked list, decode channel data, find GPS channels by name, resample channels to a common timeline, build GpsSample[]

### 2. Update: `src/lib/datalogParser.ts`
- Import the new parser functions
- Add MoTeC LD binary detection before UBX check (different magic bytes, no conflict)
- Add MoTeC CSV detection in the text format chain (before AiM, since AiM's format was actually inspired by MoTeC CSV but differs)
- Update the JSDoc comment listing supported formats

### 3. Update: `src/components/FileImport.tsx`
- Add `.ld` to the file accept attribute
- Update the format description text to include "MoTeC CSV/LD"

### 4. Update: `src/components/drawer/FilesTab.tsx`
- Add `.ld` to the file accept attribute

### 5. Update: Credits Dialog in `src/pages/Index.tsx`
- Add MoTeC i2 to the credits list with link to https://www.motec.com.au

## Technical Notes

- The LD binary parser will use the browser's native `DataView` API for struct unpacking -- no external dependencies needed
- Channels in LD files can have different sample rates (e.g., GPS at 10Hz, RPM at 100Hz). The parser will resample all channels to match the GPS channel's rate using nearest-neighbor interpolation
- MoTeC CSV detection needs to be careful not to conflict with AiM CSV (AiM uses `gps_speed`, `gps_lat` naming; MoTeC uses `Ground Speed`, `GPS Latitude`)
- The teleportation filter and G-force calculation pipeline from `parserUtils.ts` and `gforceCalculation.ts` will be reused as with all other parsers
- Float16 data type (rare in LD files) will be handled with manual IEEE 754 half-precision decoding

