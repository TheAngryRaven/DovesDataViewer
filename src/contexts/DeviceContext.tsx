import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  type BleConnection,
  connectToDevice,
  disconnect,
  isBleSupported,
} from "@/lib/bleDatalogger";

interface DeviceContextValue {
  /** Current BLE connection (null when disconnected) */
  connection: BleConnection | null;
  /** Friendly device name from BluetoothDevice */
  deviceName: string | null;
  /** True while the browser BLE picker is open */
  isConnecting: boolean;
  /** Whether Web Bluetooth is available in this browser */
  bleSupported: boolean;
  /** Initiate a connection. Returns the connection on success, null on cancel/failure. */
  connect: (onStatus?: (msg: string) => void) => Promise<BleConnection | null>;
  /** Disconnect the current device */
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
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isFlashing, setIsFlashing] = useState(false);
  const bleSupported = isBleSupported();
  const connectionRef = useRef<BleConnection | null>(null);
  const flashingRef = useRef(false);

  // Keep ref in sync for cleanup
  useEffect(() => {
    connectionRef.current = connection;
  }, [connection]);

  const setFlashing = useCallback((flashing: boolean) => {
    flashingRef.current = flashing;
    setIsFlashing(flashing);
  }, []);

  const handleDisconnect = useCallback(() => {
    // During a firmware flash the device reboots into its bootloader; that BLE
    // drop is expected, so keep the UI mounted instead of tearing it down.
    if (flashingRef.current) return;
    setConnection(null);
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

  const disconnectDevice = useCallback(() => {
    if (connectionRef.current) {
      connectionRef.current.device.removeEventListener("gattserverdisconnected", handleDisconnect);
      disconnect(connectionRef.current);
    }
    handleDisconnect();
  }, [handleDisconnect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (connectionRef.current) {
        disconnect(connectionRef.current);
      }
    };
  }, []);

  return (
    <DeviceContext.Provider
      value={{ connection, deviceName, isConnecting, bleSupported, connect: connectFn, disconnectDevice, isFlashing, setFlashing }}
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

