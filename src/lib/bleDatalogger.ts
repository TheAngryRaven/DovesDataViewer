/// <reference types="web-bluetooth" />

// BLE Datalogger Communication Service
// Connects to DovesLapTimer device and downloads files via Bluetooth

// Debug logging — gate verbose BLE logs behind this flag
const BLE_DEBUG = false;
const bleLog = (...args: unknown[]) => { if (BLE_DEBUG) console.log('[BLE]', ...args); };

// BLE UUIDs
const SERVICE_UUID = 0x1820;
const FILE_LIST_CHAR = 0x2A3D;
const FILE_REQUEST_CHAR = 0x2A3E;
const FILE_DATA_CHAR = 0x2A3F;
const FILE_STATUS_CHAR = 0x2A40;

export interface BleConnection {
  device: BluetoothDevice;
  server: BluetoothRemoteGATTServer;
  service: BluetoothRemoteGATTService;
  characteristics: {
    fileList: BluetoothRemoteGATTCharacteristic;
    fileRequest: BluetoothRemoteGATTCharacteristic;
    fileData: BluetoothRemoteGATTCharacteristic;
    fileStatus: BluetoothRemoteGATTCharacteristic;
  };
}

export interface FileInfo {
  name: string;
  size: number;
}

export interface DownloadProgress {
  received: number;
  total: number;
  percent: number;
  speed: string;
  eta: string;
}

// Check if Web Bluetooth is available
export function isBleSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

// Format bytes to human-readable string
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

// Format transfer speed
export function formatSpeed(bytesPerSecond: number): string {
  if (isNaN(bytesPerSecond) || !isFinite(bytesPerSecond)) {
    return '0 B/s';
  }
  if (bytesPerSecond < 1024) return bytesPerSecond.toFixed(0) + ' B/s';
  if (bytesPerSecond < 1048576) return (bytesPerSecond / 1024).toFixed(1) + ' KB/s';
  return (bytesPerSecond / 1048576).toFixed(2) + ' MB/s';
}

// Format time remaining
export function formatTime(seconds: number): string {
  if (isNaN(seconds) || !isFinite(seconds)) {
    return '--';
  }
  if (seconds < 60) return Math.ceil(seconds) + 's';
  const mins = Math.floor(seconds / 60);
  const secs = Math.ceil(seconds % 60);
  return `${mins}m ${secs}s`;
}

// Connect to DovesLapTimer device
export async function connectToDevice(
  onStatusChange?: (status: string) => void
): Promise<BleConnection> {
  const updateStatus = onStatusChange || (() => {});

  updateStatus('Scanning for devices...');

  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [SERVICE_UUID] }],
  });

  updateStatus('Connecting...');
  const server = await device.gatt!.connect();

  updateStatus('Getting service...');
  const service = await server.getPrimaryService(SERVICE_UUID);

  updateStatus('Getting characteristics...');
  const fileList = await service.getCharacteristic(FILE_LIST_CHAR);
  const fileRequest = await service.getCharacteristic(FILE_REQUEST_CHAR);
  const fileData = await service.getCharacteristic(FILE_DATA_CHAR);
  const fileStatus = await service.getCharacteristic(FILE_STATUS_CHAR);

  // Brief delay for stability
  await new Promise((resolve) => setTimeout(resolve, 500));

  updateStatus('Connected!');

  return {
    device,
    server,
    service,
    characteristics: {
      fileList,
      fileRequest,
      fileData,
      fileStatus,
    },
  };
}

// Request file list from device
export async function requestFileList(
  connection: BleConnection,
  onStatusChange?: (status: string) => void
): Promise<FileInfo[]> {
  const updateStatus = onStatusChange || (() => {});

  return new Promise(async (resolve, reject) => {
    let fileListBuffer = '';
    let fileListTimeout: ReturnType<typeof setTimeout> | null = null;

    const handleFileListData = (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      const decoder = new TextDecoder();
      const chunk = decoder.decode(target.value!);

      bleLog(`File list chunk (${chunk.length} bytes):`, chunk);

      // Check for END marker
      if (chunk.trim() === 'END' || chunk.includes('END')) {
        bleLog('END MARKER DETECTED');
        const cleanBuffer = fileListBuffer.replace('END', '');
        cleanup();
        resolve(parseFileList(cleanBuffer));
        return;
      }

      // Accumulate chunk
      fileListBuffer += chunk;

      // Reset timeout - if no data for 2s, assume complete
      // BLE has small MTU (~20 bytes) so large file lists arrive in many chunks
      // with possible gaps between notifications
      if (fileListTimeout) clearTimeout(fileListTimeout);
      fileListTimeout = setTimeout(() => {
        bleLog('TIMEOUT - Assuming complete');
        if (fileListBuffer.length > 0) {
          cleanup();
          resolve(parseFileList(fileListBuffer));
        }
      }, 2000);
    };

    const cleanup = () => {
      if (fileListTimeout) clearTimeout(fileListTimeout);
      connection.characteristics.fileList.removeEventListener(
        'characteristicvaluechanged',
        handleFileListData
      );
    };

    try {
      // Setup notification listener
      await connection.characteristics.fileList.startNotifications();
      connection.characteristics.fileList.addEventListener(
        'characteristicvaluechanged',
        handleFileListData
      );

      updateStatus('Requesting file list...');

      // Send LIST command
      const encoder = new TextEncoder();
      await connection.characteristics.fileRequest.writeValue(encoder.encode('LIST'));

      // Timeout after 10 seconds if no response
      setTimeout(() => {
        cleanup();
        reject(new Error('Timeout waiting for file list'));
      }, 10000);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

// Parse file list string into FileInfo array
function parseFileList(fileListStr: string): FileInfo[] {
  const files: FileInfo[] = [];
  const entries = fileListStr.split('|');

  entries.forEach((entry) => {
    if (entry.trim()) {
      const [name, sizeStr] = entry.split(':');
      if (name && sizeStr) {
        files.push({
          name: name.trim(),
          size: parseInt(sizeStr, 10),
        });
      }
    }
  });

  // Exclude non-log files (e.g. SETTINGS.json) from the download list
  return files.filter(f => f.name.toUpperCase() !== 'SETTINGS.JSON');
}

// Download a file from the device
// Optimized for high-throughput BLE transfers (125+ kBps burst rates).
// Chunks are buffered into a typed array queue with a running byte counter —
// no O(n) reduce on every notification. UI updates are throttled to rAF cadence
// so the notification handler never blocks on DOM work.
export async function downloadFile(
  connection: BleConnection,
  filename: string,
  onProgress?: (progress: DownloadProgress) => void,
  onStatusChange?: (status: string) => void
): Promise<Uint8Array> {
  const updateStatus = onStatusChange || (() => {});
  const updateProgress = onProgress || (() => {});

  return new Promise(async (resolve, reject) => {
    const receivedData: Uint8Array[] = [];
    let totalReceived = 0;
    let expectedFileSize = 0;
    let transferStartTime = Date.now();
    let progressRafId = 0;
    let progressDirty = false;
    let resolved = false;

    // Throttled progress updater — runs at most once per animation frame
    const scheduleProgressUpdate = () => {
      if (progressDirty || progressRafId) return;
      progressDirty = true;
      progressRafId = requestAnimationFrame(() => {
        progressRafId = 0;
        progressDirty = false;
        if (resolved) return;

        const percent = expectedFileSize > 0 ? (totalReceived / expectedFileSize) * 100 : 0;
        const elapsedSeconds = (Date.now() - transferStartTime) / 1000;
        const overallSpeed = elapsedSeconds > 0 ? totalReceived / elapsedSeconds : 0;
        const remainingBytes = expectedFileSize - totalReceived;
        const etaSeconds = overallSpeed > 0 ? remainingBytes / overallSpeed : 0;

        updateProgress({
          received: totalReceived,
          total: expectedFileSize,
          percent,
          speed: formatSpeed(overallSpeed),
          eta: formatTime(etaSeconds),
        });

        updateStatus(
          `Receiving: ${formatBytes(totalReceived)} / ${formatBytes(expectedFileSize)} ` +
            `(${percent.toFixed(1)}%)`
        );
      });
    };

    // Hot path — called for every BLE data notification (up to 10x per loop).
    // Must be as lean as possible: push chunk, bump counter, schedule deferred UI.
    const handleFileData = (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      const dv = target.value!;
      // Copy the DataView buffer — BLE reuses the underlying ArrayBuffer
      const chunk = new Uint8Array(dv.buffer.slice(dv.byteOffset, dv.byteOffset + dv.byteLength));
      receivedData.push(chunk);
      totalReceived += chunk.length;
      scheduleProgressUpdate();
    };

    const statusDecoder = new TextDecoder();

    const handleStatusData = (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      const status = statusDecoder.decode(target.value!);

      bleLog('Status:', status);

      if (status.startsWith('SIZE:')) {
        expectedFileSize = parseInt(status.substring(5), 10);
        updateStatus(`Receiving ${filename} (${formatBytes(expectedFileSize)})...`);
      } else if (status === 'DONE') {
        resolved = true;
        if (progressRafId) { cancelAnimationFrame(progressRafId); progressRafId = 0; }
        cleanup();
        // Assemble final file in one pass from buffered chunks
        const fileData = new Uint8Array(totalReceived);
        let offset = 0;
        for (let i = 0; i < receivedData.length; i++) {
          fileData.set(receivedData[i], offset);
          offset += receivedData[i].length;
        }
        resolve(fileData);
      } else if (status === 'ERROR') {
        resolved = true;
        if (progressRafId) { cancelAnimationFrame(progressRafId); progressRafId = 0; }
        cleanup();
        reject(new Error('Error opening file on device'));
      }
    };

    const cleanup = () => {
      connection.characteristics.fileData.removeEventListener(
        'characteristicvaluechanged',
        handleFileData
      );
      connection.characteristics.fileStatus.removeEventListener(
        'characteristicvaluechanged',
        handleStatusData
      );
    };

    try {
      // Setup notification listeners
      await connection.characteristics.fileData.startNotifications();
      connection.characteristics.fileData.addEventListener(
        'characteristicvaluechanged',
        handleFileData
      );

      await connection.characteristics.fileStatus.startNotifications();
      connection.characteristics.fileStatus.addEventListener(
        'characteristicvaluechanged',
        handleStatusData
      );

      updateStatus(`Requesting ${filename}...`);
      transferStartTime = Date.now();

      // Send GET command
      const encoder = new TextEncoder();
      await connection.characteristics.fileRequest.writeValue(
        encoder.encode('GET:' + filename)
      );

      // Timeout after 5 minutes for large files
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          if (progressRafId) { cancelAnimationFrame(progressRafId); progressRafId = 0; }
          cleanup();
          reject(new Error('Download timeout'));
        }
      }, 300000);
    } catch (error) {
      resolved = true;
      if (progressRafId) { cancelAnimationFrame(progressRafId); progressRafId = 0; }
      cleanup();
      reject(error);
    }
  });
}

// Disconnect from device
export function disconnect(connection: BleConnection): void {
  if (connection.device && connection.device.gatt?.connected) {
    connection.device.gatt.disconnect();
  }
}

// ─── Battery Protocol ─────────────────────────────────────────────────────────

export interface BatteryInfo {
  percent: number;
  voltage: number;
}

/** Request battery level from device. Sends BATT, expects BATT:<percent>,<voltage> on fileStatus. */
export async function requestBatteryLevel(
  connection: BleConnection
): Promise<BatteryInfo> {
  return new Promise(async (resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const handleNotification = (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      const raw = new TextDecoder().decode(target.value!);
      bleLog('BATT raw notification:', JSON.stringify(raw));

      const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        if (line.startsWith('BATT:')) {
          const payload = line.substring(5);
          const [pctStr, voltStr] = payload.split(',');
          const percent = parseInt(pctStr, 10);
          const voltage = parseFloat(voltStr);
          if (!isNaN(percent) && !isNaN(voltage)) {
            cleanup();
            resolve({ percent, voltage });
            return;
          }
        }
      }
    };

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      connection.characteristics.fileStatus.removeEventListener(
        'characteristicvaluechanged',
        handleNotification
      );
    };

    try {
      await connection.characteristics.fileStatus.startNotifications();
      connection.characteristics.fileStatus.addEventListener(
        'characteristicvaluechanged',
        handleNotification
      );

      const encoder = new TextEncoder();
      await connection.characteristics.fileRequest.writeValue(encoder.encode('BATT'));

      timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Battery request timed out'));
      }, 5000);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

// ─── Device Settings Protocol ─────────────────────────────────────────────────
// Uses the fileList characteristic (0x2A3D) for notifications and
// fileRequest characteristic (0x2A3E) for sending commands.

/** Request all settings from device via SLIST command. Returns key→value map. */
export async function requestSettingsList(
  connection: BleConnection
): Promise<Record<string, string>> {
  return new Promise(async (resolve, reject) => {
    const settings: Record<string, string> = {};
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const handleNotification = (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      const raw = new TextDecoder().decode(target.value!);
      bleLog('SLIST raw notification:', JSON.stringify(raw));

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
      timeout = setTimeout(() => {
        cleanup();
        resolve(settings);
      }, 3000);
    };

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      connection.characteristics.fileStatus.removeEventListener(
        'characteristicvaluechanged',
        handleNotification
      );
    };

    try {
      await connection.characteristics.fileStatus.startNotifications();
      connection.characteristics.fileStatus.addEventListener(
        'characteristicvaluechanged',
        handleNotification
      );

      const encoder = new TextEncoder();
      await connection.characteristics.fileRequest.writeValue(encoder.encode('SLIST'));

      // Hard timeout after 10s
      setTimeout(() => {
        cleanup();
        reject(new Error('Timeout waiting for settings list'));
      }, 10000);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

/** Get a single setting from device via SGET:key. */
export async function getDeviceSetting(
  connection: BleConnection,
  key: string
): Promise<string> {
  return new Promise(async (resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const handleNotification = (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      const raw = new TextDecoder().decode(target.value!);
      bleLog('SGET raw notification:', JSON.stringify(raw));

      const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);

      for (const line of lines) {
        if (line.startsWith('SVAL:')) {
          const payload = line.substring(5);
          const eqIdx = payload.indexOf('=');
          if (eqIdx > 0 && payload.substring(0, eqIdx) === key) {
            cleanup();
            resolve(payload.substring(eqIdx + 1));
            return;
          }
        } else if (line.startsWith('SERR:')) {
          cleanup();
          reject(new Error(line.substring(5)));
          return;
        }
      }
    };

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      connection.characteristics.fileStatus.removeEventListener(
        'characteristicvaluechanged',
        handleNotification
      );
    };

    try {
      await connection.characteristics.fileStatus.startNotifications();
      connection.characteristics.fileStatus.addEventListener(
        'characteristicvaluechanged',
        handleNotification
      );

      const encoder = new TextEncoder();
      await connection.characteristics.fileRequest.writeValue(encoder.encode('SGET:' + key));

      timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Timeout waiting for setting value'));
      }, 5000);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

/** Set a device setting via SSET:key=value. Resolves on SOK, rejects on SERR. */
export async function setDeviceSetting(
  connection: BleConnection,
  key: string,
  value: string
): Promise<void> {
  return new Promise(async (resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const handleNotification = (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      const raw = new TextDecoder().decode(target.value!);
      bleLog('SSET raw notification:', JSON.stringify(raw));

      const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);

      for (const line of lines) {
        if (line === 'SOK:' + key || line === 'SOK: ' + key) {
          cleanup();
          resolve();
          return;
        } else if (line.startsWith('SERR:')) {
          cleanup();
          reject(new Error(line.substring(5)));
          return;
        }
      }
    };

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      connection.characteristics.fileStatus.removeEventListener(
        'characteristicvaluechanged',
        handleNotification
      );
    };

    try {
      await connection.characteristics.fileStatus.startNotifications();
      connection.characteristics.fileStatus.addEventListener(
        'characteristicvaluechanged',
        handleNotification
      );

      const encoder = new TextEncoder();
      await connection.characteristics.fileRequest.writeValue(
        encoder.encode('SSET:' + key + '=' + value)
      );

      timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Timeout waiting for save confirmation'));
      }, 5000);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

// ─── Track File Protocol ──────────────────────────────────────────────────────
// TLIST, TGET, TPUT commands for managing track files on the device.

/** Request list of track files on device via TLIST. Returns filenames (e.g. ["OKC.json", "TEST.json"]). */
export async function requestTrackFileList(
  connection: BleConnection
): Promise<string[]> {
  return new Promise(async (resolve, reject) => {
    const files: string[] = [];
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const handleNotification = (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      const raw = new TextDecoder().decode(target.value!);
      bleLog('TLIST raw:', JSON.stringify(raw));

      const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);

      for (const line of lines) {
        if (line === 'TEND') {
          cleanup();
          resolve(files);
          return;
        }
        if (line.startsWith('TFILE:')) {
          files.push(line.substring(6));
        }
      }

      // Reset safety timeout
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        cleanup();
        resolve(files);
      }, 3000);
    };

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      connection.characteristics.fileStatus.removeEventListener(
        'characteristicvaluechanged',
        handleNotification
      );
    };

    try {
      await connection.characteristics.fileStatus.startNotifications();
      connection.characteristics.fileStatus.addEventListener(
        'characteristicvaluechanged',
        handleNotification
      );

      const encoder = new TextEncoder();
      await connection.characteristics.fileRequest.writeValue(encoder.encode('TLIST'));

      setTimeout(() => {
        cleanup();
        reject(new Error('Timeout waiting for track file list'));
      }, 10000);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

/**
 * Download a track file from device via TGET.
 * Optimized for high-throughput burst transfers — same pattern as downloadFile.
 */
export async function downloadTrackFile(
  connection: BleConnection,
  filename: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<Uint8Array> {
  const updateProgress = onProgress || (() => {});

  return new Promise(async (resolve, reject) => {
    const receivedData: Uint8Array[] = [];
    let totalReceived = 0;
    let expectedFileSize = 0;
    let transferStartTime = Date.now();
    let progressRafId = 0;
    let progressDirty = false;
    let resolved = false;

    const scheduleProgressUpdate = () => {
      if (progressDirty || progressRafId) return;
      progressDirty = true;
      progressRafId = requestAnimationFrame(() => {
        progressRafId = 0;
        progressDirty = false;
        if (resolved) return;

        const percent = expectedFileSize > 0 ? (totalReceived / expectedFileSize) * 100 : 0;
        const elapsedSeconds = (Date.now() - transferStartTime) / 1000;
        const overallSpeed = elapsedSeconds > 0 ? totalReceived / elapsedSeconds : 0;
        const remainingBytes = expectedFileSize - totalReceived;
        const etaSeconds = overallSpeed > 0 ? remainingBytes / overallSpeed : 0;

        updateProgress({
          received: totalReceived,
          total: expectedFileSize,
          percent,
          speed: formatSpeed(overallSpeed),
          eta: formatTime(etaSeconds),
        });
      });
    };

    const handleFileData = (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      const dv = target.value!;
      const chunk = new Uint8Array(dv.buffer.slice(dv.byteOffset, dv.byteOffset + dv.byteLength));
      receivedData.push(chunk);
      totalReceived += chunk.length;
      scheduleProgressUpdate();
    };

    const statusDecoder = new TextDecoder();

    const handleStatusData = (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      const raw = statusDecoder.decode(target.value!);
      bleLog('TGET status:', raw);

      const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        if (line.startsWith('SIZE:')) {
          expectedFileSize = parseInt(line.substring(5), 10);
          transferStartTime = Date.now();
        } else if (line === 'DONE') {
          resolved = true;
          if (progressRafId) { cancelAnimationFrame(progressRafId); progressRafId = 0; }
          cleanup();
          const fileData = new Uint8Array(totalReceived);
          let offset = 0;
          for (let i = 0; i < receivedData.length; i++) {
            fileData.set(receivedData[i], offset);
            offset += receivedData[i].length;
          }
          resolve(fileData);
          return;
        } else if (line.startsWith('TERR:') || line === 'ERROR') {
          resolved = true;
          if (progressRafId) { cancelAnimationFrame(progressRafId); progressRafId = 0; }
          cleanup();
          reject(new Error(line.startsWith('TERR:') ? line.substring(5) : 'Error downloading track file'));
          return;
        }
      }
    };

    const cleanup = () => {
      connection.characteristics.fileData.removeEventListener('characteristicvaluechanged', handleFileData);
      connection.characteristics.fileStatus.removeEventListener('characteristicvaluechanged', handleStatusData);
    };

    try {
      await connection.characteristics.fileData.startNotifications();
      connection.characteristics.fileData.addEventListener('characteristicvaluechanged', handleFileData);

      await connection.characteristics.fileStatus.startNotifications();
      connection.characteristics.fileStatus.addEventListener('characteristicvaluechanged', handleStatusData);

      const encoder = new TextEncoder();
      await connection.characteristics.fileRequest.writeValue(encoder.encode('TGET:' + filename));

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          if (progressRafId) { cancelAnimationFrame(progressRafId); progressRafId = 0; }
          cleanup();
          reject(new Error('Track file download timeout'));
        }
      }, 60000);
    } catch (error) {
      resolved = true;
      if (progressRafId) { cancelAnimationFrame(progressRafId); progressRafId = 0; }
      cleanup();
      reject(error);
    }
  });
}

/**
 * Upload a track file to device via TPUT.
 * Flow: TPUT:name → wait TREADY → send chunks → TDONE → wait TOK
 */
export async function uploadTrackFile(
  connection: BleConnection,
  filename: string,
  data: Uint8Array
): Promise<void> {
  return new Promise(async (resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let phase: 'waiting_ready' | 'uploading' | 'waiting_ok' = 'waiting_ready';

    const handleNotification = (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      const raw = new TextDecoder().decode(target.value!);
      bleLog('TPUT status:', raw, 'phase:', phase);

      const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        if (line === 'TREADY' && phase === 'waiting_ready') {
          phase = 'uploading';
          // Send data chunks
          sendChunks().catch(err => {
            cleanup();
            reject(err);
          });
          return;
        } else if (line === 'TOK' && phase === 'waiting_ok') {
          cleanup();
          resolve();
          return;
        } else if (line.startsWith('TERR:')) {
          cleanup();
          reject(new Error(line.substring(5)));
          return;
        }
      }
    };

    const sendChunks = async () => {
      const CHUNK_SIZE = 64;
      const encoder = new TextEncoder();

      for (let i = 0; i < data.length; i += CHUNK_SIZE) {
        const chunk = data.slice(i, Math.min(i + CHUNK_SIZE, data.length));
        await connection.characteristics.fileRequest.writeValue(chunk);
        // Small delay between chunks for device stability
        await new Promise(r => setTimeout(r, 10));
      }

      // Signal end of upload
      await connection.characteristics.fileRequest.writeValue(encoder.encode('TDONE'));
      phase = 'waiting_ok';

      // Reset timeout for TOK response
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Timeout waiting for upload confirmation'));
      }, 10000);
    };

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      connection.characteristics.fileStatus.removeEventListener(
        'characteristicvaluechanged',
        handleNotification
      );
    };

    try {
      await connection.characteristics.fileStatus.startNotifications();
      connection.characteristics.fileStatus.addEventListener(
        'characteristicvaluechanged',
        handleNotification
      );

      const encoder = new TextEncoder();
      await connection.characteristics.fileRequest.writeValue(encoder.encode('TPUT:' + filename));

      // Timeout waiting for TREADY
      timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Timeout waiting for device ready'));
      }, 10000);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

/**
 * Delete a track file from device via TDEL.
 * Flow: TDEL:name.json → wait TOK or TERR
 */
export async function deleteTrackFile(
  connection: BleConnection,
  filename: string
): Promise<void> {
  return new Promise(async (resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const handleNotification = (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      const raw = new TextDecoder().decode(target.value!);
      bleLog('TDEL status:', raw);

      const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        if (line === 'TOK') {
          cleanup();
          resolve();
          return;
        } else if (line.startsWith('TERR:')) {
          cleanup();
          reject(new Error(line.substring(5)));
          return;
        }
      }
    };

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      connection.characteristics.fileStatus.removeEventListener(
        'characteristicvaluechanged',
        handleNotification
      );
    };

    try {
      await connection.characteristics.fileStatus.startNotifications();
      connection.characteristics.fileStatus.addEventListener(
        'characteristicvaluechanged',
        handleNotification
      );

      const encoder = new TextEncoder();
      await connection.characteristics.fileRequest.writeValue(encoder.encode('TDEL:' + filename));

      timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Timeout waiting for delete confirmation'));
      }, 10000);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
