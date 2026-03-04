

# Fix: Settings BLE Protocol — Multi-Message Notifications

## Problem
The device sends all settings responses near-instantly with a 527-byte MTU. This means multiple messages (`SVAL:bluetooth_name=...`, `SVAL:bluetooth_pin=...`, `SEND`) can arrive concatenated in a single BLE notification. The current handler treats each notification as a single message, so it never sees `SEND` as an exact match when it's part of a larger string.

## Solution
Modify `requestSettingsList` in `src/lib/bleDatalogger.ts` to split each received notification by newline (or detect multiple `SVAL:`/`SEND` tokens) before processing. Same fix needed for `getDeviceSetting` and `setDeviceSetting` for robustness.

### Changes to `src/lib/bleDatalogger.ts`

In the `handleNotification` of `requestSettingsList` (~line 365-388):
- Split received text by newlines and/or detect multiple `SVAL:` prefixes
- Process each line individually
- Handle `SEND` appearing anywhere in the split lines

```typescript
const handleNotification = (event: Event) => {
  const target = event.target as BluetoothRemoteGATTCharacteristic;
  const raw = new TextDecoder().decode(target.value!);
  
  // Split on newlines — device may send multiple messages in one notification
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  
  for (const line of lines) {
    if (line === 'SEND') {
      cleanup();
      resolve(settings);
      return;
    }
    if (line.startsWith('SVAL:')) {
      const payload = line.substring(5);
      const eqIdx = payload.indexOf('=');
      if (eqIdx > 0) {
        settings[payload.substring(0, eqIdx)] = payload.substring(eqIdx + 1);
      }
    }
  }
  
  // Reset safety timeout on each message
  if (timeout) clearTimeout(timeout);
  timeout = setTimeout(() => { cleanup(); resolve(settings); }, 3000);
};
```

Apply the same newline-splitting pattern to `getDeviceSetting` and `setDeviceSetting` handlers for forward-compatibility.

Also add `console.log` of raw received data for easier future debugging.

### Files Modified
| File | Change |
|------|--------|
| `src/lib/bleDatalogger.ts` | Split notification text by newlines in all three settings protocol handlers |

