'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const PLAYACTOR_BIN = path.join(
  __dirname,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'playactor.cmd' : 'playactor'
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
  const args = [command, ...playstationSelector(device)];
  return run(PLAYACTOR_BIN, args, config.commandTimeoutMs);
}

async function runTv(device, command) {
  const tv = device.tv || {};
  if (!tv.mode || tv.mode === 'none') return 'Kontrol TV dilewati.';
  if (tv.mode !== 'adb') throw new Error('Mode TV tidak didukung: ' + tv.mode);
  if (!tv.host) throw new Error('Alamat ADB TV belum diisi.');

  await run(tv.adbPath || 'adb', ['connect', String(tv.host)], 15000);
  const keyCode = command === 'wake' ? 'KEYCODE_WAKEUP' : 'KEYCODE_SLEEP';
  return run(tv.adbPath || 'adb', ['-s', String(tv.host), 'shell', 'input', 'keyevent', keyCode], 15000);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function executeCommand(item) {
  const device = config.devices[String(item.UnitID)];
  if (!device) throw new Error('Unit ' + item.UnitID + ' belum dipetakan di config.json.');

  if (item.Perintah === 'wake') {
    await runPlaystation(device, 'wake');
    await delay(2500);
    try { await runTv(device, 'wake'); } catch (err) { log('TV tidak dapat dibangunkan:', err.message); }
    return 'PlayStation dibangunkan; perintah TV aktif dikirim.';
  }

  if (item.Perintah === 'rest') {
    await runPlaystation(device, 'standby');
    await delay(5000);
    try { await runTv(device, 'rest'); } catch (err) { log('TV tidak dapat dimatikan:', err.message); }
    return 'PlayStation masuk Rest Mode; perintah TV mati dikirim.';
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
