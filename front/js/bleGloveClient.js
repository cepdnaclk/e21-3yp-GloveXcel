export const BLE_SERVICE_UUID = "12345678-1234-1234-1234-1234567890ab";
export const BLE_CHARACTERISTIC_UUID = "87654321-4321-4321-4321-9876543210ab";

export class BleGloveClient {
  constructor() {
    this.device = null;
    this.server = null;
    this.characteristic = null;
    this.onPacket = null;
    this.onStatus = null;
  }

  async connect() {
    this._emitStatus("Requesting BLE device...");
    this.device = await navigator.bluetooth.requestDevice({
      filters: [
        { namePrefix: "ESP32" },
        { services: [BLE_SERVICE_UUID] }
      ],
      optionalServices: [BLE_SERVICE_UUID]
    });

    this.device.addEventListener("gattserverdisconnected", () => {
      this._emitStatus("Disconnected");
    });

    this._emitStatus("Connecting...");
    this.server = await this.device.gatt.connect();

    const service = await this.server.getPrimaryService(BLE_SERVICE_UUID);
    this.characteristic = await service.getCharacteristic(BLE_CHARACTERISTIC_UUID);

    await this.characteristic.startNotifications();
    this.characteristic.addEventListener("characteristicvaluechanged", (event) => {
      const packet = this._decodeFiveBytePacket(event.target.value);
      if (packet && this.onPacket) {
        this.onPacket(packet);
      }
    });

    this._emitStatus("Connected");
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
