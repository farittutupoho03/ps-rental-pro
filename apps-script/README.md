# Tambahan Backend Apps Script

`DeviceControl.gs` adalah modul antrean perintah untuk pengontrol lokal. File ini harus berada di project Apps Script PS Rental Pro dan fungsi publiknya harus ditambahkan ke `API_ACTIONS` pada `Code.gs`.

Fungsi API yang diperlukan:

- `createDeviceBridgeKey`
- `getDeviceBridgeStatus`
- `queueDeviceCommand`
- `listDeviceCommands`
- `pollDeviceCommands`
- `acknowledgeDeviceCommand`
