# Fix: Dialogs appearing behind the File Manager drawer

## Problem

When the File Manager drawer is open (e.g. via the Bluetooth/Device tab) and a dialog opens on top of it (the BLE file download dialog from `DataloggerDownload`), the dialog renders *behind* the drawer.

## Root cause

Stacking values are inconsistent across the app:

| Component | Overlay z | Content z |
|---|---|---|
| `src/components/ui/dialog.tsx` | `z-[9999]` | `z-[10000]` |
| `src/components/FileManagerDrawer.tsx` | `z-[10000]` (backdrop) | `z-[10001]` (panel) |
| `src/components/ui/sheet.tsx` | `z-50` | `z-50` |

The drawer panel (`10001`) sits above the dialog content (`10000`), so any `Dialog` opened from inside the drawer is occluded.

## Fix

Raise the shared `Dialog` primitive above the custom drawer so every dialog opened from anywhere (drawer, page, etc.) always wins.

In `src/components/ui/dialog.tsx`:
- `DialogOverlay`: `z-[9999]` → `z-[10010]`
- `DialogContent`: `z-[10000]` → `z-[10011]`

This keeps the drawer above normal page chrome but ensures any modal dialog (BLE download, export, confirmations, etc.) layers on top of it. No changes to `FileManagerDrawer` or `Sheet` are needed — the only known collision is dialog-vs-drawer, and `Sheet` (`z-50`) isn't used in conflict with the drawer.

## Verification

After the change: open the drawer → Device tab → trigger the BLE download dialog; the dialog and its overlay should sit above the drawer panel.
