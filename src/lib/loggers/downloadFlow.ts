import type { LoggerKind } from './types';

/**
 * Which download flow a "Download from logger" press should open directly,
 * or `null` to ask first with the logger picker.
 *
 * The picker exists to answer one question — *which logger?* — and a live
 * connection has already answered it. The Device tab knows the kind it is
 * talking to, so skipping straight into that logger's flow saves a tap that
 * can only be answered one way. On the web the Fledgling flow then reuses the
 * very connection that answered it (`DeviceContext.connection`).
 */
export function resolveDownloadFlow(opts: {
  /** A logger is connected on either transport (`DeviceContext.isConnected`). */
  isConnected: boolean;
  /** Which logger that connection talks to (`DeviceContext.loggerKind`). */
  loggerKind: LoggerKind | null;
  /** Running inside the native shell (`isNativeApp()`). */
  native: boolean;
}): LoggerKind | null {
  const { isConnected, loggerKind, native } = opts;
  if (!isConnected || loggerKind === null) return null;
  // MyChron (Wi-Fi) and Alfano (Bluetooth serial) only have a download flow on
  // the native shell; on the web their picker cards open an explanatory dialog,
  // which is the answer the user needs — so don't skip past it.
  if (loggerKind !== 'fledgling' && !native) return null;
  return loggerKind;
}
