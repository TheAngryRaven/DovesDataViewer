

# Device Manager: BLE Settings System

## Overview
Transform the slide-out drawer from a single "Garage" panel into a two-tab top-level panel: **Garage** (everything as-is) and **Device** (new). The Device tab has two sub-tabs: **Settings** and **Tracks** (WIP placeholder). A shared BLE connection context gates device features behind a "Connect to Logger" prompt.

## Architecture

```text
FileManagerDrawer (renamed conceptually)
├── Top tabs: [Garage] [Device]
│
├── Garage tab → existing Files/Karts/Setups/Notes (unchanged)
│
└── Device tab
    ├── [not connected] → "Connect to Logger" overlay
    └── [connected]
        ├── Sub-tabs: [Settings] [Tracks]
        ├── Settings → list of key/value pairs from SLIST, editable
        └── Tracks → "Work in Progress" placeholder
```

## What Changes

### 1. New: `src/contexts/DeviceContext.tsx` — Global BLE connection state
- Provides `connection: BleConnection | null`, `deviceName: string | null`, `isConnecting: boolean`
- `connect()` calls `connectToDevice()` from `bleDatalogger.ts`
- `disconnect()` cleans up
- Listens to `device.gatt.disconnect` event to auto-clear state
- Wraps the app (in `Index.tsx`) so both the drawer and header can read connection status

### 2. New: BLE settings protocol in `src/lib/bleDatalogger.ts`
Add three new exported functions using the existing `fileRequest` characteristic (which is the general-purpose write characteristic):
- `requestSettingsList(connection)` → sends `SLIST`, listens for `SVAL:key=value` lines until `SEND`, returns `Record<string, string>`
- `getDeviceSetting(connection, key)` → sends `SGET:key`, waits for `SVAL:key=value` or `SERR:*`
- `setDeviceSetting(connection, key, value)` → sends `SSET:key=value`, waits for `SOK:key` or `SERR:*`

These reuse the existing characteristic references. The response protocol uses the `fileList` characteristic for notifications (same as file list).

### 3. New: `src/lib/deviceSettingsSchema.ts` — Settings metadata registry
A declarative map defining each known setting key, its display label, data type, and validation:
```typescript
export interface DeviceSettingDef {
  key: string;
  label: string;
  type: 'string' | 'number';
  maxLength?: number;
  min?: number;
  max?: number;
  description?: string;
}

export const DEVICE_SETTINGS_SCHEMA: DeviceSettingDef[] = [
  { key: 'bluetooth_name', label: 'Bluetooth Name', type: 'string', maxLength: 30, description: 'Device broadcast name' },
  { key: 'bluetooth_pin', label: 'Bluetooth PIN', type: 'number', maxLength: 4, min: 0, max: 9999, description: 'Pairing PIN code' },
];
```
Unknown keys from the device are displayed as raw string fields (forward-compatible).

### 4. New: `src/components/drawer/DeviceSettingsTab.tsx`
- On mount (when connection exists), calls `requestSettingsList` to populate a `Record<string, string>` state
- Renders each setting as a row: label, current value in an input, save button per row
- Validation uses schema: shows inline error if value exceeds maxLength, out of range, etc.
- Save button calls `setDeviceSetting`, shows success/error toast
- Loading spinner while fetching, error state if fetch fails

### 5. New: `src/components/drawer/DeviceTracksTab.tsx`
Simple placeholder: centered text "Track Manager — Work in Progress" with a construction icon.

### 6. Modify: `src/components/FileManagerDrawer.tsx`
- Add a top-level tab bar above the current tab bar: **Garage** | **Device**
- When "Garage" is selected, show the existing 4-tab UI unchanged
- When "Device" is selected:
  - If no BLE connection → show a full-panel overlay with a "Connect to Logger" button (calls `connect()` from DeviceContext) and a brief message
  - If connected → show sub-tabs: Settings | Tracks
  - If user cancels the browser BLE prompt, stay on the overlay
- The drawer receives device context via `useDeviceContext()`

### 7. Modify: `src/pages/Index.tsx`
- Wrap relevant tree with `<DeviceProvider>`
- Optionally show a small BLE status indicator in the header (connected device name or dot)

## File Summary

| File | Action |
|------|--------|
| `src/contexts/DeviceContext.tsx` | **New** — global BLE connection state |
| `src/lib/deviceSettingsSchema.ts` | **New** — settings key definitions + validation |
| `src/lib/bleDatalogger.ts` | **Modify** — add SLIST/SGET/SSET protocol functions |
| `src/components/drawer/DeviceSettingsTab.tsx` | **New** — settings list UI |
| `src/components/drawer/DeviceTracksTab.tsx` | **New** — WIP placeholder |
| `src/components/FileManagerDrawer.tsx` | **Modify** — add Garage/Device top-level tabs, connection gate |
| `src/pages/Index.tsx` | **Modify** — wrap with DeviceProvider |
| `CLAUDE.md` | **Modify** — document new files |
| `README.md` | **Modify** — note device management feature |

