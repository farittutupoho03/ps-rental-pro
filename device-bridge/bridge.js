'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const dgram = require('node:dgram');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const PLAYSTATION_CREDENTIALS_PATH = path.join(__dirname, 'playstation-credentials.json');
const PLAYACTOR_CLI = path.join(
  __dirname,
  'node_modules',
  'playactor',
  'dist',
  'cli',
  'index.js'
);

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error('config.json belum ada. Salin config.example.json menjadi config.json lalu isi datanya.');
  }
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  if (!/^https:\/\//.test(cfg.apiUrl || '')) throw new Error('apiUrl harus berupa URL HTTPS Apps Script.');
  if (!cfg.bridgeKey || /PASTE_/.test(cfg.bridgeKey)) throw new Error('bridgeKey belum diisi.');
  if (!cfg.bridgeId) cfg.bridgeId = 'rental-utama';
  if (!cfg.devices || typeof cfg.devices !== 'object') cfg.devices = {};
  cfg.pollIntervalMs = Math.max(2000, Number(cfg.pollIntervalMs) || 5000);
  cfg.commandTimeoutMs = Math.max(10000, Number(cfg.commandTimeoutMs) || 45000);
  return cfg;
}

const config = loadConfig();
let stopping = false;
let polling = false;

function log(message, extra) {
  const suffix = extra ? ' ' + String(extra) : '';
  console.log('[' + new Date().toLocaleString('id-ID') + '] ' + message + suffix);
}

function run(bin, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: __dirname, windowsHide: true, shell: false });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      child.kill('SIGTERM');
      reject(new Error('Perintah melewati batas waktu.'));
    }, timeoutMs);

    child.stdout.on('data', data => { stdout += data.toString(); });
    child.stderr.on('data', data => { stderr += data.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve((stdout || stderr).trim());
      else reject(new Error((stderr || stdout || ('Proses berhenti dengan kode ' + code)).trim()));
    });
  });
}

function playstationSelector(device) {
  if (device.playstationHostId) return ['--host-id', String(device.playstationHostId)];
  if (device.playstationHostName) return ['--host-name', String(device.playstationHostName)];
  if (String(device.type).toUpperCase() === 'PS5') return ['--ps5'];
  if (String(device.type).toUpperCase() === 'PS4') return ['--ps4'];
  throw new Error('playstationHostName/playstationHostId belum diisi untuk unit ini.');
}

async function runPlaystation(device, command) {
  const args = [command, ...playstationSelector(device), '--credentials', PLAYSTATION_CREDENTIALS_PATH];
  return run(process.execPath, [PLAYACTOR_CLI, ...args], config.commandTimeoutMs);
}

async function runTv(device, command) {
  const tv = device.tv || {};
  if (!tv.mode || tv.mode === 'none') return 'Kontrol TV dilewati.';
  if (tv.mode === 'androidtv_remote') return runAndroidTvRemote(device, command);
  if (tv.mode !== 'adb') throw new Error('Mode TV tidak didukung: ' + tv.mode);
  if (!tv.host) throw new Error('Alamat ADB TV belum diisi.');

  await run(tv.adbPath || 'adb', ['connect', String(tv.host)], 15000);
  const keyCode = command === 'wake' ? 'KEYCODE_WAKEUP' : 'KEYCODE_SLEEP';
  return run(tv.adbPath || 'adb', ['-s', String(tv.host), 'shell', 'input', 'keyevent', keyCode], 15000);
}

function runAndroidTvRemote(device, command) {
  const tv = device.tv || {};
  const certificatePath = path.resolve(__dirname, tv.certificatePath || 'tv-remote-cert.json');
  if (!fs.existsSync(certificatePath)) throw new Error('TV belum dipasangkan. Jalankan PASANG-REMOTE-TV.cmd.');

  const { AndroidRemote, RemoteKeyCode, RemoteDirection } = require('androidtv-remote');
  const certificate = JSON.parse(fs.readFileSync(certificatePath, 'utf8'));
  const host = String(tv.host || '').split(':')[0];
  if (!host) throw new Error('Alamat IP TV belum diisi.');

  return new Promise((resolve, reject) => {
    const remote = new AndroidRemote(host, {
      pairing_port: 6467,
      remote_port: 6466,
      service_name: 'PS Rental Pro',
      cert: certificate
    });
    let settled = false;
    let commandSent = false;
    const finish = (error, message) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (remote.remoteManager?.client) remote.remoteManager.client.removeAllListeners('close');
        remote.stop();
      } catch (_) {}
      if (error) reject(error);
      else resolve(message);
    };
    const timer = setTimeout(() => finish(new Error('TV tidak merespons melalui Remote Android TV.')), 15000);

    remote.on('powered', powered => {
      if (commandSent) return;
      commandSent = true;
      try {
        setTimeout(() => {
          try {
            if (command === 'wake') {
              remote.sendKey(RemoteKeyCode.KEYCODE_WAKEUP, RemoteDirection.SHORT);
            } else if (powered) {
              remote.sendPower();
            }
            setTimeout(() => finish(null, 'Perintah TV ' + command + ' dikirim.'), 2000);
          } catch (error) {
            finish(error);
          }
        }, 500);
      } catch (error) {
        finish(error);
      }
    });
    remote.on('unpaired', () => finish(new Error('TV tidak lagi berpasangan. Jalankan PASANG-REMOTE-TV.cmd lagi.')));
    remote.start().catch(finish);
  });
}

async function showTvWarning(device) {
  const tv = device.tv || {};
  if (tv.mode === 'adb' && tv.host) {
    const adb = tv.adbPath || 'adb';
    await run(adb, ['connect', String(tv.host)], 15000);
    return run(adb, [
      '-s', String(tv.host), 'shell', 'cmd', 'notification', 'post',
      '-S', 'bigtext', '-t', 'PS Rental Pro',
      'ps_rental_warning', 'Sisa waktu bermain 5 menit. Silakan selesaikan permainan.'
    ], 15000);
  }
  if (tv.mode === 'androidtv_remote') {
    return 'Peringatan 5 menit aktif pada layar Display. Mode Android TV Remote tidak mendukung teks overlay di atas HDMI.';
  }
  return 'Peringatan 5 menit dicatat; TV ini belum memakai mode tampilan pesan.';
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function wakeTvOnly(device) {
  const tv = device.tv || {};
  const mac = String(tv.mac || '').replace(/[^0-9a-f]/gi, '').toLowerCase();
  if (!/^[0-9a-f]{12}$/.test(mac)) {
    throw new Error('MAC TV belum tersimpan. Jalankan DETEKSI-MAC-TV.cmd saat TV menyala.');
  }

  const macBytes = Buffer.from(mac, 'hex');
  const packet = Buffer.alloc(102);
  packet.fill(0xff, 0, 6);
  for (let offset = 6; offset < packet.length; offset += 6) macBytes.copy(packet, offset);

  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    socket.once('error', error => { socket.close(); reject(error); });
    socket.bind(() => {
      socket.setBroadcast(true);
      let sent = 0;
      const sendPacket = () => {
        socket.send(packet, 9, tv.broadcast || '255.255.255.255', error => {
          if (error) { socket.close(); reject(error); return; }
          sent += 1;
          if (sent >= 3) {
            socket.close();
            resolve('Sinyal nyala TV dikirim melalui Wake-on-LAN.');
          } else {
            setTimeout(sendPacket, 250);
          }
        });
      };
      sendPacket();
    });
  });
}

async function executeCommand(item) {
  const device = config.devices[String(item.UnitID)];
  if (!device) throw new Error('Unit ' + item.UnitID + ' belum dipetakan di config.json.');

  if (item.Perintah === 'tv_wake') {
    return await wakeTvOnly(device);
  }

  if (item.Perintah === 'warning_5min') {
    return await showTvWarning(device);
  }

  if (item.Perintah === 'wake') {
    await runPlaystation(device, 'wake');
    await delay(2500);
    if (device.tv?.mode === 'androidtv_remote') {
      return 'PlayStation dibangunkan; TV mengikuti melalui HDMI-CEC.';
    }
    try { await runTv(device, 'wake'); } catch (err) { log('TV tidak dapat dibangunkan:', err.message); }
    return 'PlayStation dibangunkan; perintah TV aktif dikirim.';
  }

  if (item.Perintah === 'rest') {
    const tv = device.tv || {};
    if ((tv.mode === 'adb' || tv.mode === 'androidtv_remote') && tv.host) {
      try {
        await runTv(device, 'rest');
        return 'TV dimatikan; PlayStation masuk Rest Mode melalui HDMI-CEC.';
      } catch (err) {
        log('TV tidak dapat dimatikan, mencoba Rest langsung ke PlayStation:', err.message);
      }
    }
    await runPlaystation(device, 'standby');
    return 'PlayStation masuk Rest Mode.';
  }

  if (item.Perintah === 'status') {
    return await runPlaystation(device, 'check');
  }

  throw new Error('Perintah tidak dikenal: ' + item.Perintah);
}

async function callApi(action, args) {
  const url = new URL(config.apiUrl);
  url.searchParams.set('action', action);
  url.searchParams.set('args', JSON.stringify(args));
  url.searchParams.set('_ts', Date.now().toString());
  const response = await fetch(url, { redirect: 'follow', cache: 'no-store' });
  if (!response.ok) throw new Error('API HTTP ' + response.status);
  const payload = await response.json();
  if (!payload.success) throw new Error(payload.message || 'API menolak permintaan.');
  return payload.data;
}

async function acknowledge(item, status, message) {
  await callApi('acknowledgeDeviceCommand', [
    config.bridgeKey,
    config.bridgeId,
    item.ID,
    status,
    String(message || '').slice(0, 500)
  ]);
}

async function poll() {
  if (polling || stopping) return;
  polling = true;
  try {
    const commands = await callApi('pollDeviceCommands', [config.bridgeKey, config.bridgeId]);
    for (const item of commands || []) {
      log('Menjalankan ' + item.Perintah + ' untuk ' + item.UnitID + '...');
      try {
        const message = await executeCommand(item);
        await acknowledge(item, 'Berhasil', message);
        log('Berhasil:', message);
      } catch (err) {
        await acknowledge(item, 'Gagal', err.message).catch(() => {});
        log('Gagal:', err.message);
      }
    }
  } catch (err) {
    log('Bridge belum dapat mengambil antrean:', err.message);
  } finally {
    polling = false;
  }
}

process.on('SIGINT', () => { stopping = true; log('Bridge dihentikan.'); process.exit(0); });
process.on('SIGTERM', () => { stopping = true; log('Bridge dihentikan.'); process.exit(0); });

log('PS Rental Pro Device Bridge aktif sebagai ' + config.bridgeId + '.');
poll();
setInterval(poll, config.pollIntervalMs);
