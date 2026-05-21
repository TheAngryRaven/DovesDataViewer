/// <reference types="web-bluetooth" />

/**
 * Vitest-side mock for Web Bluetooth.
 *
 * Provides a `BleConnection`-shaped object whose characteristics are
 * test-controllable: each characteristic records `writeValue` calls and
 * exposes a `simulate()` helper that fires a `characteristicvaluechanged`
 * event with arbitrary payload bytes. This lets every protocol test be
 * written as:
 *
 *   const conn = createMockConnection();
 *   const result = requestX(conn);             // start the operation
 *   await flushMicrotasks();                   // let the async setup settle
 *   expect(lastWritten(...)).toBe("X");        // verify command sent
 *   conn.characteristics.fileStatus.simulate("X-RESPONSE\n");
 *   await expect(result).resolves.toEqual(...);
 *
 * The mock is intentionally minimal — it only implements the surface the
 * protocols actually use (startNotifications, addEventListener / remove,
 * writeValue) plus a test-only `simulate`. It is NOT a faithful Web
 * Bluetooth emulation.
 */

import type { BleConnection } from "../types";

/**
 * Test-only extras layered on top of BluetoothRemoteGATTCharacteristic.
 * Kept as a separate interface (NOT extending) to avoid this-type variance
 * issues on `oncharacteristicvaluechanged` when widening.
 */
export interface MockCharacteristic {
  /** Notifications enabled flag (set when startNotifications is awaited). */
  notificationsStarted: boolean;
  /** Cumulative log of payloads passed to writeValue, in call order. */
  written: Uint8Array[];
  /** Fire a `characteristicvaluechanged` event with the given payload. */
  simulate(payload: string | Uint8Array): void;
}

/** Connection-side view: each characteristic IS a real one + the test extras. */
type MockedChar = BluetoothRemoteGATTCharacteristic & MockCharacteristic;

/** Decode the most recent writeValue payload as UTF-8 text. */
export function lastWritten(char: MockedChar): string {
  const last = char.written.at(-1);
  if (!last) throw new Error("No writeValue calls recorded");
  return new TextDecoder().decode(last);
}

/** Returns the count of writeValue calls so far. */
export function writeCount(char: MockedChar): number {
  return char.written.length;
}

/**
 * Allow the protocol's async setup (startNotifications + writeValue awaits) to
 * settle before the test simulates a response. A few rounds of microtask flush
 * is enough — none of our mocks yield to the macrotask queue.
 */
export async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

function createMockCharacteristic(): MockedChar {
  // Use a plain object built around an EventTarget. EventTarget gives us
  // addEventListener / removeEventListener / dispatchEvent for free.
  const target = new EventTarget();
  const written: Uint8Array[] = [];
  // `value` is read by the protocols on the dispatched event's target; we set
  // it just before dispatching simulate() payloads.
  let currentValue: DataView | null = null;

  const characteristic = {
    // BLE methods we actually use
    notificationsStarted: false,
    written,
    async startNotifications() {
      this.notificationsStarted = true;
      return this as unknown as BluetoothRemoteGATTCharacteristic;
    },
    async writeValue(data: BufferSource) {
      const bytes = data instanceof Uint8Array
        ? data
        : ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
          : new Uint8Array(data);
      // Copy so later mutations to the source don't change what we recorded
      written.push(new Uint8Array(bytes));
    },
    get value(): DataView | null {
      return currentValue;
    },
    // Delegate event-target methods to the internal EventTarget
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
    simulate(payload: string | Uint8Array) {
      const bytes = typeof payload === "string"
        ? new TextEncoder().encode(payload)
        : payload;
      // Build a fresh ArrayBuffer so the DataView has clean byteOffset semantics
      const buf = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buf).set(bytes);
      currentValue = new DataView(buf);
      const event = new Event("characteristicvaluechanged");
      // event.target is the dispatching EventTarget; the protocols cast it to
      // BluetoothRemoteGATTCharacteristic and read .value — which we just set.
      // Override target so it points back at the characteristic (the mock) and
      // .value is reachable.
      Object.defineProperty(event, "target", { value: characteristic, configurable: true });
      target.dispatchEvent(event);
    },
  };

  return characteristic as unknown as MockedChar;
}

export function createMockConnection(): BleConnection & {
  characteristics: {
    fileList: MockedChar;
    fileRequest: MockedChar;
    fileData: MockedChar;
    fileStatus: MockedChar;
  };
} {
  const characteristics = {
    fileList: createMockCharacteristic(),
    fileRequest: createMockCharacteristic(),
    fileData: createMockCharacteristic(),
    fileStatus: createMockCharacteristic(),
  };
  // The protocols only touch `.characteristics`, so the device/server/service
  // fields are stub shapes that satisfy the type but are never read.
  return {
    device: { gatt: { connected: true } } as unknown as BluetoothDevice,
    server: {} as BluetoothRemoteGATTServer,
    service: {} as BluetoothRemoteGATTService,
    characteristics,
  };
}
