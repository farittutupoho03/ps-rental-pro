/**
 * Antrean kontrol perangkat untuk bridge lokal PS Rental Pro.
 * Frontend menambahkan perintah; bridge lokal mengambil dan mengakuinya.
 */

var DEVICE_COMMAND_SHEET = 'PerintahPerangkat';
var DEVICE_COMMAND_HEADERS = [
  'ID', 'Waktu', 'UnitID', 'Perintah', 'Referensi', 'Alasan', 'Status',
  'BridgeID', 'DikirimPada', 'SelesaiPada', 'Pesan'
];
var DEVICE_BRIDGE_HASH_PROPERTY = 'DEVICE_BRIDGE_KEY_HASH';
var DEVICE_BRIDGE_LAST_SEEN_PROPERTY = 'DEVICE_BRIDGE_LAST_SEEN';
var DEVICE_BRIDGE_LAST_ID_PROPERTY = 'DEVICE_BRIDGE_LAST_ID';

function deviceCommandSheet_() {
  var ss = getDatabase_();
  var sheet = ss.getSheetByName(DEVICE_COMMAND_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(DEVICE_COMMAND_SHEET);
    sheet.getRange(1, 1, 1, DEVICE_COMMAND_HEADERS.length).setValues([DEVICE_COMMAND_HEADERS]);
    sheet.getRange(1, 1, 1, DEVICE_COMMAND_HEADERS.length)
      .setFontWeight('bold').setBackground('#4a4a4a').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function deviceCommandObject_(row) {
  var obj = {};
  DEVICE_COMMAND_HEADERS.forEach(function (header, index) { obj[header] = row[index]; });
  return obj;
}

function deviceSecretHash_(secret) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(secret || ''));
  return bytes.map(function (b) {
    var value = b < 0 ? b + 256 : b;
    return ('0' + value.toString(16)).slice(-2);
  }).join('');
}

function validateDeviceBridgeKey_(bridgeKey) {
  var expected = PropertiesService.getScriptProperties().getProperty(DEVICE_BRIDGE_HASH_PROPERTY);
  if (!expected || deviceSecretHash_(bridgeKey) !== expected) throw new Error('Kunci bridge tidak valid.');
}

function createDeviceBridgeKey(token) {
  requireRole_(token, ['Owner']);
  var key = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  var props = PropertiesService.getScriptProperties();
  props.setProperty(DEVICE_BRIDGE_HASH_PROPERTY, deviceSecretHash_(key));
  props.deleteProperty(DEVICE_BRIDGE_LAST_SEEN_PROPERTY);
  props.deleteProperty(DEVICE_BRIDGE_LAST_ID_PROPERTY);
  deviceCommandSheet_();
  return ok_({ bridgeKey: key }, 'Kunci bridge berhasil dibuat.');
}

function getDeviceBridgeStatus(token) {
  requireRole_(token, ['Owner']);
  var props = PropertiesService.getScriptProperties();
  var configured = !!props.getProperty(DEVICE_BRIDGE_HASH_PROPERTY);
  var lastSeenRaw = props.getProperty(DEVICE_BRIDGE_LAST_SEEN_PROPERTY) || '';
  var lastSeenMs = lastSeenRaw ? new Date(lastSeenRaw).getTime() : 0;
  var sheet = deviceCommandSheet_();
  var values = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, DEVICE_COMMAND_HEADERS.length).getValues()
    : [];
  var pendingCount = values.filter(function (row) {
    return row[6] === 'Menunggu' || row[6] === 'Dikirim';
  }).length;
  return ok_({
    configured: configured,
    online: configured && lastSeenMs > 0 && Date.now() - lastSeenMs < 30000,
    bridgeId: props.getProperty(DEVICE_BRIDGE_LAST_ID_PROPERTY) || '',
    lastSeen: lastSeenRaw,
    pendingCount: pendingCount
  });
}

function queueDeviceCommand(token, unitId, command, referenceId, reason) {
  var user = requireRole_(token, ['Owner', 'Kasir']);
  unitId = String(unitId || '').trim();
  command = String(command || '').toLowerCase().trim();
  referenceId = String(referenceId || '').trim();
  reason = String(reason || '').trim();
  if (!unitId) return fail_('ID unit wajib diisi.');
  if (['wake', 'tv_wake', 'warning_5min', 'rest', 'status'].indexOf(command) === -1) return fail_('Perintah perangkat tidak dikenal.');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = deviceCommandSheet_();
    var lastRow = sheet.getLastRow();
    if (referenceId && lastRow > 1) {
      var startRow = Math.max(2, lastRow - 199);
      var recent = sheet.getRange(startRow, 1, lastRow - startRow + 1, DEVICE_COMMAND_HEADERS.length).getValues();
      for (var i = recent.length - 1; i >= 0; i--) {
        if (String(recent[i][2]) === unitId && String(recent[i][3]) === command &&
            String(recent[i][4]) === referenceId && String(recent[i][6]) !== 'Gagal') {
          return ok_({ id: recent[i][0], duplicate: true }, 'Perintah sudah ada di antrean.');
        }
      }
    }

    var id = 'CMD-' + Utilities.getUuid().split('-')[0].toUpperCase();
    sheet.appendRow([id, new Date(), unitId, command, referenceId, reason, 'Menunggu', '', '', '', '']);
    if (typeof logActivity_ === 'function') {
      logActivity_(user.username || user.nama || 'User', 'Kontrol Perangkat', command + ' ' + unitId);
    }
    return ok_({ id: id, duplicate: false }, 'Perintah masuk antrean.');
  } finally {
    lock.releaseLock();
  }
}

function listDeviceCommands(token, limit) {
  requireRole_(token, ['Owner']);
  limit = Math.min(100, Math.max(1, Number(limit) || 30));
  var sheet = deviceCommandSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return ok_([]);
  var count = Math.min(limit, lastRow - 1);
  var values = sheet.getRange(lastRow - count + 1, 1, count, DEVICE_COMMAND_HEADERS.length).getValues();
  return ok_(values.reverse().map(deviceCommandObject_));
}

function pollDeviceCommands(bridgeKey, bridgeId) {
  validateDeviceBridgeKey_(bridgeKey);
  bridgeId = String(bridgeId || 'bridge').slice(0, 80);
  var props = PropertiesService.getScriptProperties();
  props.setProperty(DEVICE_BRIDGE_LAST_SEEN_PROPERTY, new Date().toISOString());
  props.setProperty(DEVICE_BRIDGE_LAST_ID_PROPERTY, bridgeId);

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = deviceCommandSheet_();
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return ok_([]);
    var values = sheet.getRange(2, 1, lastRow - 1, DEVICE_COMMAND_HEADERS.length).getValues();
    var selected = [];
    var now = Date.now();
    for (var i = 0; i < values.length && selected.length < 10; i++) {
      var status = String(values[i][6]);
      var sentAt = values[i][8] ? new Date(values[i][8]).getTime() : 0;
      var retryExpired = status === 'Dikirim' && sentAt > 0 && now - sentAt > 120000;
      if (status !== 'Menunggu' && !retryExpired) continue;
      values[i][6] = 'Dikirim';
      values[i][7] = bridgeId;
      values[i][8] = new Date();
      sheet.getRange(i + 2, 7, 1, 3).setValues([[values[i][6], values[i][7], values[i][8]]]);
      selected.push(deviceCommandObject_(values[i]));
    }
    return ok_(selected);
  } finally {
    lock.releaseLock();
  }
}

function acknowledgeDeviceCommand(bridgeKey, bridgeId, commandId, status, message) {
  validateDeviceBridgeKey_(bridgeKey);
  status = String(status || 'Gagal');
  if (['Berhasil', 'Gagal'].indexOf(status) === -1) status = 'Gagal';
  var sheet = deviceCommandSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return fail_('Perintah tidak ditemukan.');
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) !== String(commandId)) continue;
    sheet.getRange(i + 2, 7, 1, 5).setValues([[
      status,
      String(bridgeId || '').slice(0, 80),
      sheet.getRange(i + 2, 9).getValue() || new Date(),
      new Date(),
      String(message || '').slice(0, 500)
    ]]);
    return ok_({ id: commandId, status: status });
  }
  return fail_('Perintah tidak ditemukan.');
}
