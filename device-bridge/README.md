# PS Rental Pro Device Bridge

Bridge ini dijalankan pada komputer Windows, mini PC, atau Raspberry Pi yang selalu aktif dan terhubung ke Wi-Fi/LAN yang sama dengan PS4, PS5, dan TV. Aplikasi mengirim perintah melalui Apps Script; bridge mengambil antrean dan menjalankan `wake`, `standby`, serta kontrol daya Android TV.

> Kontrol PlayStation memakai proyek komunitas `playactor`, bukan API resmi Sony. Uji setiap unit sebelum dipakai untuk operasional rental dan tetap sediakan kontrol manual.

## Persyaratan

- Node.js 18 atau lebih baru.
- PS4/PS5 berada dalam Rest Mode, terhubung ke internet, dan fitur **Enable Turning On from Network** aktif.
- HDMI Device Link/CEC aktif pada TV dan PlayStation.
- Untuk TV Xiaomi/Android TV: Android Platform Tools (`adb`) tersedia pada PATH dan debugging jaringan sudah diaktifkan.

## Pemasangan

1. Buka folder `device-bridge` pada komputer lokal.
2. Jalankan `npm install`.
3. Jalankan `npm run browse` untuk melihat nama PS4/PS5 di jaringan.
4. Jalankan `npm run login` dan ikuti proses pemasangan akun PlayStation satu kali.
5. Di PS Rental Pro buka **Kontrol Perangkat → Buat Kunci Bridge**.
6. Salin `config.example.json` menjadi `config.json`.
7. Isi `apiUrl`, `bridgeKey`, serta pasangan ID unit aplikasi dengan nama PlayStation dan alamat TV.
8. Jalankan `npm start`.

## Contoh pemetaan

Kunci objek dalam `devices` harus sama dengan kolom **ID** pada halaman PlayStation, misalnya `PS001`. `playstationHostName` diperoleh dari `npm run browse`. Untuk Xiaomi TV, `tv.host` berisi alamat IP TV dan port ADB, misalnya `192.168.1.50:5555`.

## Pengujian

1. Pastikan PS berada di Rest Mode.
2. Buka **Kontrol Perangkat** di aplikasi.
3. Tekan **Bangunkan**; PS harus aktif dan TV mengikuti melalui HDMI-CEC.
4. Tekan **Rest**; bridge memasukkan PS ke Rest Mode, menunggu lima detik, lalu mematikan TV.

Jangan menyimpan `config.json` ke GitHub karena berisi kunci rahasia bridge.
