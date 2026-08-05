import { createContext, useContext, type ReactNode } from "react";
import { useDeviceContext } from "@/contexts/DeviceContext";
import { useFirmwareUpdate } from "@/hooks/useFirmwareUpdate";
import {
  FirmwareUpdateDialog,
  type FirmwareUpdateApi,
} from "@/components/drawer/FirmwareUpdateDialog";

const FirmwareUpdateContext = createContext<FirmwareUpdateApi | null>(null);

/**
 * Owns the one and only `useFirmwareUpdate` instance, and renders its dialog.
 *
 * The hook used to live inside `FirmwareUpdateSection`, several conditions deep
 * in the drawer — so an update check that fires on connect had nowhere to show
 * itself. Mounting a second instance instead would mean two device-version
 * reads over GATT and, worse, two dialogs racing to be the one on screen.
 *
 * Must sit inside `DeviceProvider`: the hook reads the connection and the
 * device name from it.
 */
export function FirmwareUpdateProvider({ children }: { children: ReactNode }) {
  const { connection } = useDeviceContext();
  const fw = useFirmwareUpdate(connection);

  return (
    <FirmwareUpdateContext.Provider value={fw}>
      {children}
      <FirmwareUpdateDialog fw={fw} />
    </FirmwareUpdateContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- hook is conventionally co-located with its provider
export function useFirmwareUpdateApi(): FirmwareUpdateApi {
  const ctx = useContext(FirmwareUpdateContext);
  if (!ctx) throw new Error("useFirmwareUpdateApi must be used within <FirmwareUpdateProvider>");
  return ctx;
}
