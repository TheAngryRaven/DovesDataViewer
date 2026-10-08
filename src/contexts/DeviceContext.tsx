import {
  createContext, lazy, Suspense, useCallback, useContext, useEffect, useRef, useState, type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  type BleConnection,
  connectToDevice,
  disconnect,
  isBleSupported,
  reconnectDevice,
} from "@/lib/bleDatalogger";
import type { AuthPhase, LinkEndNotice, LoggerAuthError, PinPromptContext } from "@/lib/ble/auth";
import type { DeviceDetails, LoggerKind } from "@/lib/loggers";
import { createBleDeviceDetails } from "@/lib/loggers/bleDetails";
import {
  acquireNativeConnection,
  nativeConnectionOwner,
  releaseNativeConnection,
} from "@/lib/loggers/native/owner";
import type { ScannedDevice } from "@/lib/loggers/doveslogger/ipc";

// The remote-transfer PIN handshake (plan 0031) and its prompt load on the
// first connect, keeping them off the landing payload.
const LoggerPinDialog = lazy(() =>
  import("@/components/LoggerPinDialog").then((m) => ({ default: m.LoggerPinDialog })),
);

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
  const { t } = useTranslation("drawer");
  // The pending remote-transfer PIN prompt (plan 0031) and how to answer it.
  const [pinRequest, setPinRequest] = useState<PinPromptContext | null>(null);
  const pinResolveRef = useRef<((pin: string | null) => void) | null>(null);
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
  // Unsubscribes the session-ending-notice watch on the live connection.
  const stopNoticeWatchRef = useRef<(() => void) | null>(null);

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
    stopNoticeWatchRef.current?.();
    stopNoticeWatchRef.current = null;
    // During a firmware flash the device reboots into its bootloader; that BLE
    // drop is expected, so keep the UI mounted instead of tearing it down.
    if (flashingRef.current) return;
    setConnection(null);
    setNativeConnected(false);
    setDetails(null);
    setLoggerKind(null);
    setDeviceName(null);
  }, []);

  const promptPin = useCallback((ctx: PinPromptContext, signal: AbortSignal) => {
    return new Promise<string | null>((resolve) => {
      // The logger ended the session for good while the prompt was open:
      // close it (the handshake toasts why).
      signal.addEventListener("abort", () => {
        if (pinResolveRef.current !== resolve) return;
        pinResolveRef.current = null;
        setPinRequest(null);
        resolve(null);
      });
      pinResolveRef.current = resolve;
      setPinRequest(ctx);
    });
  }, []);

  const finishPinPrompt = useCallback((pin: string | null) => {
    const resolve = pinResolveRef.current;
    pinResolveRef.current = null;
    setPinRequest(null);
    resolve?.(pin);
  }, []);

  const authErrorMessage = useCallback((err: LoggerAuthError) => {
    switch (err.code) {
      case "locked": return t("pin.errorLocked", { seconds: err.seconds ?? 0 });
      case "camera": return t("pin.errorCamera");
      case "timeout": return t("pin.errorTimeout");
      case "engine": return t("pin.errorEngine");
      case "idle": return t("pin.errorIdle");
      case "busy": return t("pin.errorBusy");
      case "noReply": return t("pin.errorNoReply");
      case "disconnected": return t("pin.errorDisconnected");
      default: return t("pin.errorProtocol");
    }
  }, [t]);

  const linkEndMessage = useCallback((notice: LinkEndNotice) => {
    switch (notice) {
      case "camera": return t("pin.errorCamera");
      case "engine": return t("pin.errorEngine");
      case "idle": return t("pin.errorIdle");
      default: return t("pin.errorTimeout");
    }
  }, [t]);

  const connectFn = useCallback(async (onStatus?: (msg: string) => void): Promise<BleConnection | null> => {
    if (isConnecting) return null;
    if (connectionRef.current) return connectionRef.current;
    setIsConnecting(true);
    let conn: BleConnection;
    try {
      conn = await connectToDevice(onStatus);
    } catch (err) {
      // User cancelled the picker or connection failed
      console.warn("BLE connect failed/cancelled:", err);
      setIsConnecting(false);
      return null;
    }
    try {
      // A logger started remotely from its menu answers nothing but the PIN
      // handshake until it is satisfied; a local start or older firmware
      // passes straight through.
      const auth = await import("@/lib/ble/auth");
      const device = conn.device;
      let result;
      try {
        result = await auth.authenticateLogger(conn, {
          promptPin,
          reconnect: () => reconnectDevice(device),
          onPhase: (phase: AuthPhase) => {
            if (phase === "pin") onStatus?.(t("pin.checking"));
            else if (phase === "reconnecting") onStatus?.(t("pin.reconnecting"));
            else onStatus?.(t("pin.handshake"));
          },
        });
      } catch (err) {
        disconnect(conn);
        // authenticateLogger only ever rejects with LoggerAuthError.
        const authErr = err as LoggerAuthError;
        if (authErr.code !== "cancelled") toast.error(authErrorMessage(authErr));
        return null;
      }
      conn = result.connection;
      // The logger can end the session on its own (camera, engine start,
      // idle): say why before the disconnect tears the UI down.
      stopNoticeWatchRef.current?.();
      stopNoticeWatchRef.current = auth.watchLinkEndNotices(conn, (notice) => {
        toast.error(linkEndMessage(notice));
      });
      // Listen for unexpected disconnects
      conn.device.addEventListener("gattserverdisconnected", handleDisconnect);
      setConnection(conn);
      setDetails(createBleDeviceDetails(conn));
      // Web Bluetooth only ever reaches the Fledgling today.
      setLoggerKind("fledgling");
      setDeviceName(conn.device.name ?? "Unknown Device");
      return conn;
    } catch {
      // Loading the handshake module failed (offline chunk miss).
      disconnect(conn);
      toast.error(t("pin.errorProtocol"));
      return null;
    } finally {
      setIsConnecting(false);
    }
  }, [isConnecting, handleDisconnect, promptPin, authErrorMessage, linkEndMessage, t]);

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
      // Settle a PIN prompt still open so the handshake fails and disconnects
      // its half-open link instead of waiting forever.
      const resolvePin = pinResolveRef.current;
      pinResolveRef.current = null;
      resolvePin?.(null);
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
      {pinRequest && (
        <Suspense fallback={null}>
          <LoggerPinDialog request={pinRequest} onDone={finishPinPrompt} />
        </Suspense>
      )}
    </DeviceContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- useDeviceContext hook is conventionally co-located with DeviceProvider
export function useDeviceContext(): DeviceContextValue {
  const ctx = useContext(DeviceContext);
  if (!ctx) throw new Error("useDeviceContext must be used within <DeviceProvider>");
  return ctx;
}
