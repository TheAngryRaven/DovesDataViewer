import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  type BleConnection,
  connectToDevice,
  disconnect,
  isBleSupported,
} from "@/lib/bleDatalogger";
import type { DeviceDetails, LoggerKind } from "@/lib/loggers";
import { createBleDeviceDetails } from "@/lib/loggers/bleDetails";
import {
  acquireNativeConnection,
  nativeConnectionOwner,
  releaseNativeConnection,
} from "@/lib/loggers/native/owner";
import type { ScannedDevice } from "@/lib/loggers/doveslogger/ipc";

/** DeviceContext's label in the native connection-ownership token. */
const OWNER = "device-tab";

interface DeviceContextValue {
  /**
   * Current Web Bluetooth connection (null when disconnected — and always null
   * on the native app, where the transport is the logger IPC instead). Web-only
   * surfaces (the firmware OTA section) still need the raw handle.
   */
  connection: BleConnection | null;
  /** True when a device is connected on either transport. */
  isConnected: boolean;
  /**
   * The transport-neutral Device-tab surface (settings / tracks / battery),
   * present whenever connected — wraps Web Bluetooth on the web and the native
   * logger IPC in the app.
   */
  details: DeviceDetails | null;
  /**
   * Which logger the current connection talks to (null when disconnected). Only
   * the Fledgling connects today; this lets surfaces like the Device tab gate
   * logger-specific features as other transports (MyChron, Alfano) land.
   */
  loggerKind: LoggerKind | null;
  /** Friendly device name from BluetoothDevice / the native device info. */
  deviceName: string | null;
  /** True while the browser BLE picker is open / a native connect is in flight. */
  isConnecting: boolean;
  /** Whether Web Bluetooth is available in this browser */
  bleSupported: boolean;
  /** Initiate a Web Bluetooth connection. Returns the connection on success, null on cancel/failure. */
  connect: (onStatus?: (msg: string) => void) => Promise<BleConnection | null>;
  /**
   * Native only: scan (~5 s) for nearby Fledglings over the logger IPC. BLE has
   * no OS picker, so the caller renders the returned list and passes the chosen
   * device's `id` to `connectNative`.
   */
  scanNative: () => Promise<ScannedDevice[]>;
  /**
   * Native only: connect to a scanned Fledgling. Rejects with
   * `native-connection-busy` when a download dialog currently owns the single
   * native connection slot (the UI should tell the user to close it first).
   */
  connectNative: (deviceId?: string) => Promise<void>;
  /** Disconnect the current device (either transport) */
  disconnectDevice: () => void;
  /** True while a firmware flash is in progress (suppresses auto-disconnect teardown). */
  isFlashing: boolean;
  /**
   * Mark a firmware flash as active/inactive. While active, the expected BLE
   * drop (the device reboots into its bootloader) does NOT reset the connection
   * state, so the firmware UI stays mounted across the reboot.
   */
  setFlashing: (flashing: boolean) => void;
}

const DeviceContext = createContext<DeviceContextValue | null>(null);

export function DeviceProvider({ children }: { children: ReactNode }) {
  const [connection, setConnection] = useState<BleConnection | null>(null);
  const [nativeConnected, setNativeConnected] = useState(false);
  const [details, setDetails] = useState<DeviceDetails | null>(null);
  const [loggerKind, setLoggerKind] = useState<LoggerKind | null>(null);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isFlashing, setIsFlashing] = useState(false);
  const bleSupported = isBleSupported();
  const connectionRef = useRef<BleConnection | null>(null);
  const nativeConnectedRef = useRef(false);
  const flashingRef = useRef(false);

  // Keep refs in sync for cleanup
  useEffect(() => {
    connectionRef.current = connection;
  }, [connection]);
  useEffect(() => {
    nativeConnectedRef.current = nativeConnected;
  }, [nativeConnected]);

  const setFlashing = useCallback((flashing: boolean) => {
    flashingRef.current = flashing;
    setIsFlashing(flashing);
  }, []);

  const handleDisconnect = useCallback(() => {
    // During a firmware flash the device reboots into its bootloader; that BLE
    // drop is expected, so keep the UI mounted instead of tearing it down.
    if (flashingRef.current) return;
    setConnection(null);
    setNativeConnected(false);
    setDetails(null);
    setLoggerKind(null);
    setDeviceName(null);
  }, []);

  const connectFn = useCallback(async (onStatus?: (msg: string) => void): Promise<BleConnection | null> => {
    if (isConnecting) return null;
    if (connectionRef.current) return connectionRef.current;
    setIsConnecting(true);
    try {
      const conn = await connectToDevice(onStatus);
      // Listen for unexpected disconnects
      conn.device.addEventListener("gattserverdisconnected", handleDisconnect);
      setConnection(conn);
      setDetails(createBleDeviceDetails(conn));
      // Web Bluetooth only ever reaches the Fledgling today.
      setLoggerKind("fledgling");
      setDeviceName(conn.device.name ?? "Unknown Device");
      return conn;
    } catch (err) {
      // User cancelled the picker or connection failed
      console.warn("BLE connect failed/cancelled:", err);
      return null;
    } finally {
      setIsConnecting(false);
    }
  }, [isConnecting, handleDisconnect]);

  const scanNative = useCallback(async (): Promise<ScannedDevice[]> => {
    // Lazy import keeps Tauri off the web/eager graph (Golden Rule #1).
    const { loggerScan } = await import("@/lib/loggers/doveslogger/ipc");
    return loggerScan();
  }, []);

  const connectNative = useCallback(async (deviceId?: string): Promise<void> => {
    if (isConnecting || nativeConnectedRef.current) return;
    if (!acquireNativeConnection(OWNER)) {
      // A download dialog holds the single native connection slot.
      throw new Error(`native-connection-busy:${nativeConnectionOwner() ?? ""}`);
    }
    setIsConnecting(true);
    try {
      const { loggerConnect } = await import("@/lib/loggers/doveslogger/ipc");
      const { createNativeDeviceDetails } = await import(
        "@/lib/loggers/doveslogger/dovesloggerConnection"
      );
      const info = await loggerConnect({ host: deviceId });
      setNativeConnected(true);
      setDetails(createNativeDeviceDetails());
      // The IPC reports kind "doveslogger" — the same physical logger family
      // the app calls "fledgling".
      setLoggerKind("fledgling");
      setDeviceName(info.name ?? info.model ?? "PerchWerks Fledgling");
    } catch (err) {
      releaseNativeConnection(OWNER);
      throw err;
    } finally {
      setIsConnecting(false);
    }
  }, [isConnecting]);

  const disconnectDevice = useCallback(() => {
    if (connectionRef.current) {
      connectionRef.current.device.removeEventListener("gattserverdisconnected", handleDisconnect);
      disconnect(connectionRef.current);
    }
    if (nativeConnectedRef.current) {
      // Best-effort IPC teardown; errors are swallowed by loggerDisconnect.
      void import("@/lib/loggers/doveslogger/ipc").then(({ loggerDisconnect }) => loggerDisconnect());
      releaseNativeConnection(OWNER);
    }
    handleDisconnect();
  }, [handleDisconnect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (connectionRef.current) {
        disconnect(connectionRef.current);
      }
      if (nativeConnectedRef.current) {
        void import("@/lib/loggers/doveslogger/ipc").then(({ loggerDisconnect }) => loggerDisconnect());
        releaseNativeConnection(OWNER);
      }
    };
  }, []);

  return (
    <DeviceContext.Provider
      value={{
        connection,
        isConnected: connection !== null || nativeConnected,
        details,
        loggerKind,
        deviceName,
        isConnecting,
        bleSupported,
        connect: connectFn,
        scanNative,
        connectNative,
        disconnectDevice,
        isFlashing,
        setFlashing,
      }}
    >
      {children}
    </DeviceContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- useDeviceContext hook is conventionally co-located with DeviceProvider
export function useDeviceContext(): DeviceContextValue {
  const ctx = useContext(DeviceContext);
  if (!ctx) throw new Error("useDeviceContext must be used within <DeviceProvider>");
  return ctx;
}
