/**
 * WebSerial Manager for Arduino Leonardo (ATmega32U4)
 * Uses navigator.serial (WebSerial API) exclusively.
 * Handles on-chip USB CDC re-enumeration, clean stream tearing,
 * lock release, explicit DTR/RTS signals, backpressure, and robust flashing disconnect.
 */

class WebSerialManager {
  constructor() {
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.readLoopPromise = null;

    this.baudRate = 9600;
    this.isConnected = false;
    this.isClosing = false;
    this.isWriting = false;
    this.isReconnecting = false;
    this.isFlashingMode = false;
    this.autoReconnect = true;

    this.writeQueue = [];
    this.textDecoder = new TextDecoder();
    this.reconnectTimer = null;

    this.onConnectCallbacks = [];
    this.onDisconnectCallbacks = [];
    this.onDataCallbacks = [];
    this.onStatusCallbacks = [];

    this.initDeviceEventListeners();
  }

  isSupported() {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
  }

  initDeviceEventListeners() {
    if (!this.isSupported()) return;

    // Listen for physical disconnect or board reset into bootloader (2341:0036)
    navigator.serial.addEventListener('disconnect', async (event) => {
      console.log('%c[WebSerial Event] Device disconnected:', 'color: #e37400; font-weight: bold;', event.target);
      if (this.port && (this.port === event.target || this.isSamePort(this.port, event.target))) {
        await this.handleDeviceDisconnect(event.target);
      }
    });

    // Listen for board re-enumeration back into application mode (2341:8036)
    navigator.serial.addEventListener('connect', async (event) => {
      console.log('%c[WebSerial Event] Device connected:', 'color: #188038; font-weight: bold;', event.target);
      await this.handleDeviceConnect(event.target);
    });
  }

  isSamePort(p1, p2) {
    if (p1 === p2) return true;
    try {
      const info1 = p1.getInfo();
      const info2 = p2.getInfo();
      return (
        info1.usbVendorId === info2.usbVendorId &&
        info1.usbProductId === info2.usbProductId &&
        info1.usbVendorId !== undefined
      );
    } catch (e) {
      return false;
    }
  }

  isLeonardoApp(info) {
    if (!info) return false;
    return (
      (info.usbVendorId === 0x2341 && info.usbProductId === 0x8036) ||
      (info.usbVendorId === 0x2a03 && info.usbProductId === 0x8036)
    );
  }

  isLeonardoBootloader(info) {
    if (!info) return false;
    return info.usbVendorId === 0x2341 && info.usbProductId === 0x0036;
  }

  onConnect(cb) { this.onConnectCallbacks.push(cb); }
  onDisconnect(cb) { this.onDisconnectCallbacks.push(cb); }
  onData(cb) { this.onDataCallbacks.push(cb); }
  onStatus(cb) { this.onStatusCallbacks.push(cb); }

  notifyConnect() { this.onConnectCallbacks.forEach(cb => cb()); }
  notifyDisconnect(info) { this.onDisconnectCallbacks.forEach(cb => cb(info)); }
  notifyData(data) { this.onDataCallbacks.forEach(cb => cb(data)); }
  notifyStatus(status) { this.onStatusCallbacks.forEach(cb => cb(status)); }

  /**
   * Request user permission and select a WebSerial port
   */
  async requestPort() {
    const filters = [
      { usbVendorId: 0x2341, usbProductId: 0x8036 }, // Arduino Leonardo (app)
      { usbVendorId: 0x2341, usbProductId: 0x0036 }, // Arduino Leonardo (bootloader)
      { usbVendorId: 0x2341, usbProductId: 0x8037 }, // Arduino Micro
      { usbVendorId: 0x2a03, usbProductId: 0x8036 }, // Arduino.org Leonardo
      { usbVendorId: 0x1b4f, usbProductId: 0x9205 }, // Pro Micro 5V
      { usbVendorId: 0x1b4f, usbProductId: 0x9206 }, // Pro Micro 3.3V
      { usbVendorId: 0x2341 }                        // Any Arduino
    ];

    try {
      return await navigator.serial.requestPort({ filters });
    } catch (err) {
      if (err.name === 'NotFoundError') {
        throw err;
      }
      return await navigator.serial.requestPort();
    }
  }

  /**
   * Connect to specified port or prompt user if none provided
   */
  async connect(targetPort = null) {
    if (!this.isSupported()) {
      alert('Το WebSerial API δεν υποστηρίζεται σε αυτόν τον περιηγητή.\nΠαρακαλούμε χρησιμοποιήστε Google Chrome, Microsoft Edge ή Opera.');
      return false;
    }

    try {
      const portToOpen = targetPort || (await this.requestPort());
      if (!portToOpen) return false;

      // If already connected, tear it down cleanly first
      if (this.isConnected) {
        await this.disconnect();
      }

      this.port = portToOpen;
      this.isClosing = false;
      this.isReconnecting = false;
      this.isFlashingMode = false;

      // Open connection at 9600 baud
      console.log('%c[WebSerial] Opening port at 9600 baud...', 'color: #1967d2; font-weight: bold;');
      await this.port.open({ baudRate: this.baudRate });

      // Explicitly assert DTR (true) and clear RTS (false) for ATmega32U4
      if (typeof this.port.setSignals === 'function') {
        try {
          await this.port.setSignals({ dataTerminalReady: true, requestToSend: false });
          console.log('[WebSerial] Signals set: DTR=true, RTS=false');
        } catch (sigErr) {
          console.warn('Failed to set initial serial control signals:', sigErr);
        }
      }

      // Initialize Writer
      this.writer = this.port.writable.getWriter();

      // Initialize Reader & Read Loop
      this.reader = this.port.readable.getReader();
      this.readLoopPromise = this.startReadLoop();

      this.isConnected = true;
      console.log('%c[WebSerial] Successfully connected to Arduino Leonardo!', 'color: #188038; font-weight: bold;');
      this.notifyConnect();
      return true;
    } catch (err) {
      if (err.name !== 'NotFoundError') {
        console.error('WebSerial connection error:', err);
        alert('Σφάλμα σύνδεσης WebSerial: ' + err.message);
      }
      await this.cleanupStreamLocks();
      return false;
    }
  }

  /**
   * Continuous reading loop with clean cancellation handling and console logging
   */
  async startReadLoop() {
    try {
      while (this.port && this.port.readable && !this.isClosing) {
        const { value, done } = await this.reader.read();
        if (done) {
          break;
        }
        if (value) {
          const text = this.textDecoder.decode(value);
          // Console logging of serial data from the controller
          console.log('%c[Controller RX Raw]:%c ' + JSON.stringify(text), 'color: #188038; font-weight: bold;', 'color: inherit;');
          this.notifyData(text);
        }
      }
    } catch (err) {
      if (!this.isClosing) {
        console.warn('WebSerial stream reading terminated:', err);
      }
    } finally {
      if (this.reader) {
        try {
          this.reader.releaseLock();
        } catch (e) {}
        this.reader = null;
      }
    }
  }

  /**
   * Robust Stream Tearing & Lock Release
   * Ensures readers and writers are canceled, released, and port.close() resolved.
   */
  async disconnect() {
    if (this.isClosing) return;
    this.isClosing = true;

    console.log('%c[WebSerial] Disconnecting and releasing all stream locks...', 'color: #e37400;');

    // Reject all pending queued writes
    while (this.writeQueue.length > 0) {
      const pending = this.writeQueue.shift();
      pending.reject(new Error('Port closed'));
    }

    // 1. Cancel and release reader lock
    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch (err) {}
    }

    // Wait with timeout for readLoop to finish and release its lock
    if (this.readLoopPromise) {
      try {
        await Promise.race([
          this.readLoopPromise,
          new Promise(r => setTimeout(r, 400))
        ]);
      } catch (err) {}
      this.readLoopPromise = null;
    }

    // 2. Close and release writer lock
    if (this.writer) {
      try {
        await this.writer.close();
      } catch (err) {
        try {
          await this.writer.abort();
        } catch (e) {}
      } finally {
        try {
          this.writer.releaseLock();
        } catch (e) {}
        this.writer = null;
      }
    }

    // 3. Fully resolve port.close()
    if (this.port) {
      try {
        await this.port.close();
        console.log('%c[WebSerial] port.close() resolved cleanly.', 'color: #188038;');
      } catch (err) {
        console.warn('WebSerial port.close() warning:', err);
      }
      this.port = null;
    }

    this.isConnected = false;
    this.isClosing = false;
    this.notifyDisconnect({ intentional: true });
  }

  /**
   * Cleanup stream locks without throwing exceptions
   */
  async cleanupStreamLocks() {
    this.isClosing = true;

    if (this.reader) {
      try { await this.reader.cancel(); } catch (e) {}
      try { this.reader.releaseLock(); } catch (e) {}
      this.reader = null;
    }

    if (this.writer) {
      try { this.writer.releaseLock(); } catch (e) {}
      this.writer = null;
    }

    if (this.port) {
      try { await this.port.close(); } catch (e) {}
      this.port = null;
    }

    this.isConnected = false;
    this.isClosing = false;
  }

  /**
   * Robust Disconnect specifically for Flashing New Code:
   * Guarantees browser drops all streams and locks immediately,
   * puts auto-reconnect on hold during bootloader stage so avrdude / IDE
   * has exclusive COM port access, and waits for application reboot.
   */
  async prepareForFlashing() {
    this.isFlashingMode = true;
    this.isReconnecting = false;
    if (this.reconnectTimer) {
      clearInterval(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    console.log('%c[WebSerial Flashing Prep] Releasing serial port for Arduino IDE upload...', 'color: #1967d2; font-weight: bold;');

    if (this.isConnected) {
      await this.disconnect();
    } else {
      await this.cleanupStreamLocks();
    }

    console.log('%c[WebSerial Flashing Prep] Port is 100% free! Ready for Upload in Arduino IDE.', 'color: #188038; font-weight: bold;');
    this.notifyStatus('Η θύρα αποδεσμεύτηκε πλήρως! Μπορείτε να πατήσετε Upload στο Arduino IDE.');
  }

  /**
   * Handle board disconnect / reset into bootloader
   */
  async handleDeviceDisconnect(disconnectedPort) {
    console.warn('[WebSerial] Board disconnected (upload, 1200 bps touch, or cable unhook)');
    await this.cleanupStreamLocks();

    this.notifyStatus('Η συσκευή αποσυνδέθηκε (πιθανή επανεκκίνηση ή upload)...');
    this.notifyDisconnect({ intentional: false });

    // If auto-reconnect is enabled and not in manual flashing mode, start polling
    if (this.autoReconnect && !this.isFlashingMode) {
      this.startReconnectionWatcher();
    }
  }

  /**
   * Handle board re-enumeration
   */
  async handleDeviceConnect(connectedPort) {
    const info = connectedPort.getInfo();
    console.log('[WebSerial] Device enumerated:', info);

    // Bootloader mode (0x2341:0x0036): Leave it strictly alone for avrdude!
    if (this.isLeonardoBootloader(info)) {
      console.log('%c[WebSerial] Leonardo is currently in Bootloader mode (flashing in progress). Standing by...', 'color: #e37400;');
      this.notifyStatus('Arduino Leonardo σε Bootloader mode (flashing)...');
      return;
    }

    // Application mode (0x2341:0x8036): Board is ready
    if (this.isLeonardoApp(info)) {
      if (this.isFlashingMode) {
        this.isFlashingMode = false;
        console.log('%c[WebSerial] Upload complete! Leonardo rebooted in application mode.', 'color: #188038; font-weight: bold;');
        this.notifyStatus('Το upload ολοκληρώθηκε! Το Leonardo επανεκκίνησε.');
      }

      if (this.autoReconnect) {
        console.log('[WebSerial] Auto-reconnecting in 800ms...');
        setTimeout(async () => {
          if (!this.isConnected) {
            const ok = await this.connect(connectedPort);
            if (ok) {
              console.log('%c[WebSerial] Auto-reconnect successful!', 'color: #188038; font-weight: bold;');
              this.notifyStatus('Επανασυνδέθηκε αυτόματα με το Leonardo!');
            }
          }
        }, 800);
      }
    }
  }

  /**
   * Polls permitted ports to detect Leonardo application mode after flashing
   */
  startReconnectionWatcher() {
    if (this.reconnectTimer) clearInterval(this.reconnectTimer);
    this.isReconnecting = true;

    let attempts = 0;
    const maxAttempts = 30; // 30 * 500ms = 15 seconds

    this.reconnectTimer = setInterval(async () => {
      attempts++;
      if (this.isConnected || !this.isReconnecting || attempts > maxAttempts) {
        clearInterval(this.reconnectTimer);
        this.reconnectTimer = null;
        this.isReconnecting = false;
        return;
      }

      try {
        const ports = await navigator.serial.getPorts();
        for (const p of ports) {
          const info = p.getInfo();
          if (this.isLeonardoApp(info)) {
            clearInterval(this.reconnectTimer);
            this.reconnectTimer = null;
            this.isReconnecting = false;
            console.log('[WebSerial] Found permitted Leonardo application port. Reconnecting...');
            this.notifyStatus('Εντοπίστηκε το Leonardo. Επανασύνδεση...');
            await this.connect(p);
            break;
          }
        }
      } catch (err) {
        console.warn('Re-enumeration polling error:', err);
      }
    }, 500);
  }

  /**
   * Backpressure & Outgoing Throughput
   * Enqueues data into a sequential write queue awaiting writer.ready
   */
  async send(data) {
    if (!this.isConnected || !this.port || this.isClosing) {
      return false;
    }

    let buffer;
    if (typeof data === 'string') {
      const encoder = new TextEncoder();
      buffer = encoder.encode(data);
    } else if (typeof data === 'number') {
      buffer = new Uint8Array([data]);
    } else if (data instanceof Uint8Array) {
      buffer = data;
    } else {
      buffer = new Uint8Array(data);
    }

    return new Promise((resolve, reject) => {
      this.writeQueue.push({ buffer, resolve, reject, raw: data });
      this.flushWriteQueue();
    });
  }

  async flushWriteQueue() {
    if (this.isWriting || this.writeQueue.length === 0 || !this.writer || this.isClosing) {
      return;
    }

    this.isWriting = true;
    const task = this.writeQueue.shift();

    try {
      if (this.writer.ready) {
        await this.writer.ready;
      }
      console.log('%c[Controller TX]:%c', 'color: #1967d2; font-weight: bold;', task.raw);
      await this.writer.write(task.buffer);
      task.resolve(true);
    } catch (err) {
      console.warn('WebSerial write failure:', err);
      task.reject(err);
    } finally {
      this.isWriting = false;
      if (this.writeQueue.length > 0 && !this.isClosing) {
        this.flushWriteQueue();
      }
    }
  }
}

// Global instance
window.serialManager = new WebSerialManager();
