export const BLE_SERVICE_UUID = "12345678-1234-1234-1234-1234567890ab";
export const BLE_CHARACTERISTIC_UUID = "87654321-4321-4321-4321-9876543210ab";
export const BLE_MOTOR_CMD_UUID = "11111111-2222-3333-4444-555555555555";

export class BleGloveClient {
  constructor() {
    this.device = null;
    this.server = null;
    this.sensorCharacteristic = null;
    this.motorCharacteristic = null;
    this.keepAliveInterval = null;
    this.sensorPollInterval = null;
    this.sensorListener = null;
    this.disconnectListener = null;
    this.onPacket = null;
    this.onStatus = null;
  }

  async connect() {
    if (!navigator.bluetooth) {
      throw new Error("Web Bluetooth is not available in this browser/context");
    }

    this._emitStatus("Looking for remembered BLE devices...");

    const rememberedDevice = await this._connectToRememberedDevice();
    if (rememberedDevice) {
      return;
    }

    this._emitStatus("Requesting BLE device...");

    const requestedDevice = await navigator.bluetooth.requestDevice({
      filters: [
        { services: [BLE_SERVICE_UUID] }
      ],
      optionalServices: [BLE_SERVICE_UUID]
    });

    await this._connectToDevice(requestedDevice, "Connecting...");
  }

  async _connectToRememberedDevice() {
    if (typeof navigator.bluetooth.getDevices !== "function") {
      return false;
    }

    let remembered = [];
    try {
      remembered = await navigator.bluetooth.getDevices();
    } catch {
      remembered = [];
    }

    if (!Array.isArray(remembered) || remembered.length === 0) {
      return false;
    }

    for (const candidate of remembered) {
      if (!candidate || !candidate.gatt) {
        continue;
      }

      try {
        await this._connectToDevice(candidate, "Reconnecting to remembered device...");
        return true;
      } catch (error) {
        console.warn("Remembered device reconnect attempt failed:", error);
      }
    }

    return false;
  }

  async _connectToDevice(device, statusMessage) {
    this._cleanupConnectionState();

    this.device = device;
    if (!this.device || !this.device.gatt) {
      throw new Error("Selected device does not support GATT");
    }

    if (this.disconnectListener) {
      this.device.removeEventListener("gattserverdisconnected", this.disconnectListener);
    }

    this.disconnectListener = () => {
      this._cleanupConnectionState();
      this._emitStatus("Disconnected");
    };
    this.device.addEventListener("gattserverdisconnected", this.disconnectListener);

    this._emitStatus(statusMessage);
    this.server = await this.device.gatt.connect();

    const service = await this.server.getPrimaryService(BLE_SERVICE_UUID);

    try {
      this.sensorCharacteristic = await service.getCharacteristic(BLE_CHARACTERISTIC_UUID);
    } catch {
      this.sensorCharacteristic = null;
    }

    try {
      this.motorCharacteristic = await service.getCharacteristic(BLE_MOTOR_CMD_UUID);
      await this.motorCharacteristic.writeValueWithResponse(new Uint8Array([0]));
      this._startKeepAlive();
    } catch (error) {
      this.motorCharacteristic = null;
      console.warn("Motor characteristic unavailable:", error);
    }

    if (!this.motorCharacteristic && !this.sensorCharacteristic) {
      throw new Error("Required BLE characteristics not available on selected device");
    }

    await this._startSensorStreaming();

    if (this.sensorCharacteristic) {
      if (this.motorCharacteristic) {
        this._emitStatus("Connected");
      } else {
        this._emitStatus("Connected (sensor only)");
      }
    } else {
      this._emitStatus("Connected for motor control. Sensor unavailable.");
    }
  }

  disconnect() {
    this._cleanupConnectionState(true);
    this._emitStatus("Disconnected");
  }

  async sendMotorLevel(level) {
    if (!this.motorCharacteristic) {
      throw new Error("Motor characteristic unavailable");
    }

    const normalizedLevel = Number(level);
    if (!Number.isFinite(normalizedLevel) || normalizedLevel < 1 || normalizedLevel > 10) {
      throw new Error("Force level must be between 1 and 10");
    }

    await this.motorCharacteristic.writeValueWithResponse(new Uint8Array([Math.round(normalizedLevel)]));
  }

  _startKeepAlive() {
    this._stopKeepAlive();
    this.keepAliveInterval = setInterval(async () => {
      if (!this.motorCharacteristic) {
        return;
      }

      try {
        await this.motorCharacteristic.writeValueWithoutResponse(new Uint8Array([0]));
      } catch {
        try {
          await this.motorCharacteristic.writeValueWithResponse(new Uint8Array([0]));
        } catch {
          // Keep-alive best effort.
        }
      }
    }, 3000);
  }

  async _startSensorStreaming() {
    if (!this.sensorCharacteristic) {
      this._stopSensorPolling();
      return;
    }

    if (this.sensorListener) {
      this.sensorCharacteristic.removeEventListener("characteristicvaluechanged", this.sensorListener);
    }

    this.sensorListener = (event) => {
      const packet = this._decodeFiveBytePacket(event.target.value);
      if (packet && this.onPacket) {
        this.onPacket(packet);
      }
    };

    this.sensorCharacteristic.addEventListener("characteristicvaluechanged", this.sensorListener);

    try {
      await this.sensorCharacteristic.startNotifications();
    } catch (error) {
      console.warn("Sensor notifications unavailable, using read polling.", error);
    }

    this._startSensorPolling();
  }

  _startSensorPolling() {
    this._stopSensorPolling();

    if (!this.sensorCharacteristic) {
      return;
    }

    this.sensorPollInterval = setInterval(async () => {
      if (!this.sensorCharacteristic) {
        return;
      }

      try {
        const value = await this.sensorCharacteristic.readValue();
        const packet = this._decodeFiveBytePacket(value);
        if (packet && this.onPacket) {
          this.onPacket(packet);
        }
      } catch {
        // Read polling is best effort.
      }
    }, 300);
  }

  _stopSensorPolling() {
    if (this.sensorPollInterval) {
      clearInterval(this.sensorPollInterval);
      this.sensorPollInterval = null;
    }
  }

  _stopKeepAlive() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }

  _cleanupConnectionState(shouldDisconnect = false) {
    const activeDevice = this.device;

    this._stopKeepAlive();
    this._stopSensorPolling();

    if (this.sensorCharacteristic && this.sensorListener) {
      this.sensorCharacteristic.removeEventListener("characteristicvaluechanged", this.sensorListener);
    }

    if (activeDevice && this.disconnectListener) {
      activeDevice.removeEventListener("gattserverdisconnected", this.disconnectListener);
    }

    if (shouldDisconnect && activeDevice?.gatt?.connected) {
      try {
        activeDevice.gatt.disconnect();
      } catch {
        // Best effort explicit disconnect.
      }
    }

    this.sensorListener = null;
    this.disconnectListener = null;
    this.device = null;
    this.sensorCharacteristic = null;
    this.motorCharacteristic = null;
    this.server = null;
  }

  _decodeFiveBytePacket(dataView) {
    if (!dataView || dataView.byteLength < 5) {
      return null;
    }

    return [
      dataView.getUint8(0),
      dataView.getUint8(1),
      dataView.getUint8(2),
      dataView.getUint8(3),
      dataView.getUint8(4)
    ];
  }

  _emitStatus(message) {
    if (this.onStatus) {
      this.onStatus(message);
    }
  }
}
