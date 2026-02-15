/// <reference types="web-bluetooth" />

// BLE Datalogger Communication Service
// Connects to DovesLapTimer device and downloads files via Bluetooth

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
  const updateStatus = onStatusChange || console.log;

  updateStatus('Scanning for devices...');

  const device = await navigator.bluetooth.requestDevice({
    filters: [{ name: 'DovesLapTimer' }],
    optionalServices: [SERVICE_UUID],
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
  const updateStatus = onStatusChange || console.log;

  return new Promise(async (resolve, reject) => {
    let fileListBuffer = '';
    let fileListTimeout: ReturnType<typeof setTimeout> | null = null;

    const handleFileListData = (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      const decoder = new TextDecoder();
      const chunk = decoder.decode(target.value!);

      console.log(`File list chunk (${chunk.length} bytes):`, chunk);

      // Check for END marker
      if (chunk.trim() === 'END' || chunk.includes('END')) {
        console.log('=== END MARKER DETECTED ===');
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
        console.log('=== TIMEOUT - Assuming complete ===');
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

  return files;
}

// Download a file from the device
export async function downloadFile(
  connection: BleConnection,
  filename: string,
  onProgress?: (progress: DownloadProgress) => void,
  onStatusChange?: (status: string) => void
): Promise<Uint8Array> {
  const updateStatus = onStatusChange || console.log;
  const updateProgress = onProgress || (() => {});

  return new Promise(async (resolve, reject) => {
    const receivedData: Uint8Array[] = [];
    let expectedFileSize = 0;
    let transferStartTime = Date.now();
    let lastSpeedUpdate = Date.now();
    const speedSamples: number[] = [];

    const handleFileData = (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      const chunk = new Uint8Array(target.value!.buffer);
      receivedData.push(chunk);

      const totalReceived = receivedData.reduce((sum, arr) => sum + arr.length, 0);
      const percent = expectedFileSize > 0 ? (totalReceived / expectedFileSize) * 100 : 0;

      // Calculate speed
      const now = Date.now();
      const elapsedSeconds = (now - transferStartTime) / 1000;
      const timeSinceLastUpdate = (now - lastSpeedUpdate) / 1000;
      
      if (timeSinceLastUpdate > 0) {
        const instantSpeed = chunk.length / timeSinceLastUpdate;
        speedSamples.push(instantSpeed);

        // Keep last 10 samples for smoothing
        if (speedSamples.length > 10) {
          speedSamples.shift();
        }
      }

      const overallSpeed = elapsedSeconds > 0 ? totalReceived / elapsedSeconds : 0;

      // Calculate ETA
      const remainingBytes = expectedFileSize - totalReceived;
      const etaSeconds = overallSpeed > 0 ? remainingBytes / overallSpeed : 0;

      lastSpeedUpdate = now;

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
    };

    const handleStatusData = (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic;
      const decoder = new TextDecoder();
      const status = decoder.decode(target.value!);

      console.log('Status:', status);

      if (status.startsWith('SIZE:')) {
        expectedFileSize = parseInt(status.substring(5), 10);
        updateStatus(`Receiving ${filename} (${formatBytes(expectedFileSize)})...`);
      } else if (status === 'DONE') {
        cleanup();
        // Combine all chunks into single array
        const totalSize = receivedData.reduce((sum, arr) => sum + arr.length, 0);
        const fileData = new Uint8Array(totalSize);
        let offset = 0;
        receivedData.forEach((chunk) => {
          fileData.set(chunk, offset);
          offset += chunk.length;
        });
        resolve(fileData);
      } else if (status === 'ERROR') {
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
      lastSpeedUpdate = Date.now();

      // Send GET command
      const encoder = new TextEncoder();
      await connection.characteristics.fileRequest.writeValue(
        encoder.encode('GET:' + filename)
      );

      // Timeout after 5 minutes for large files
      setTimeout(() => {
        cleanup();
        reject(new Error('Download timeout'));
      }, 300000);
    } catch (error) {
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
