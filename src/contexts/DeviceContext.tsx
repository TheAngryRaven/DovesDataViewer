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
  /** Initiate a connection. Returns true on success. */
  connect: () => Promise<boolean>;
  /** Disconnect the current device */
  disconnectDevice: () => void;
}

const DeviceContext = createContext<DeviceContextValue | null>(null);

export function DeviceProvider({ children }: { children: ReactNode }) {
  const [connection, setConnection] = useState<BleConnection | null>(null);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const bleSupported = isBleSupported();
  const connectionRef = useRef<BleConnection | null>(null);

  // Keep ref in sync for cleanup
  useEffect(() => {
    connectionRef.current = connection;
  }, [connection]);

  const handleDisconnect = useCallback(() => {
    setConnection(null);
    setDeviceName(null);
  }, []);

  const connectFn = useCallback(async (): Promise<boolean> => {
    if (isConnecting) return false;
    setIsConnecting(true);
    try {
      const conn = await connectToDevice();
      // Listen for unexpected disconnects
      conn.device.addEventListener("gattserverdisconnected", handleDisconnect);
      setConnection(conn);
      setDeviceName(conn.device.name ?? "Unknown Device");
      return true;
    } catch (err) {
      // User cancelled the picker or connection failed
      console.warn("BLE connect failed/cancelled:", err);
      return false;
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
      value={{ connection, deviceName, isConnecting, bleSupported, connect: connectFn, disconnectDevice }}
    >
      {children}
    </DeviceContext.Provider>
  );
}

export function useDeviceContext(): DeviceContextValue {
  const ctx = useContext(DeviceContext);
  if (!ctx) throw new Error("useDeviceContext must be used within <DeviceProvider>");
  return ctx;
}

