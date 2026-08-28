/**
 * Sheet helpers retained ONLY for one-time import (9_SheetsImport.gs).
 * Runtime EquipCare features use VeloxInternal-API — do not add new Sheet writes here.
 */

function getSs_() {
  var id = getEquipCareSpreadsheetId_();
  try {
    return SpreadsheetApp.openById(id);
  } catch (e) {
    var email = '';
    try {
      email = Session.getEffectiveUser().getEmail() || '';
    } catch (ignore) {}
    throw new Error(
      'Cannot open spreadsheet ' +
        id +
        '. Share that Google Sheet with ' +
        (email || 'the account running this script') +
        ' (Viewer is enough), or set Script property EC_SPREADSHEET_ID to a Sheet you own. Original: ' +
        (e && e.message ? e.message : e)
    );
  }
}

/** Header map from row 1 of the sheet data range (handles sparse trailing columns). */
function headerMap_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (!values.length) return {};
  var headers = values[0];
  var map = {};
  for (var c = 0; c < headers.length; c++) {
    var h = String(headers[c] || '').trim();
    if (h) map[h] = c;
  }
  return map;
}

/** All data rows (from row 2) using getDataRange so blank-looking trailing rows still load. */
function getRowsFrom2_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  return values.slice(1);
}

function sheetHasAnyValue_(row) {
  if (!row || !row.length) return false;
  for (var i = 0; i < row.length; i++) {
    if (row[i] == null) continue;
    if (String(row[i]).trim() !== '') return true;
  }
  return false;
}

function parseSheetAssetId_(v) {
  if (v == null || v === '') return null;
  var n = Number(v);
  if (!isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

/** Creates Postgres equipcare schema/tables via API (replaces Sheet tab bootstrap). */
function ensureEquipCareSheets() {
  requireEcApiConfigured_();
  var result = migrateEquipCareApi();
  return 'EquipCare API migrate OK: ' + JSON.stringify(result.steps || result);
}
