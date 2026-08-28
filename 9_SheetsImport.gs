/**
 * Sheets → Postgres import via VeloxInternal-API POST /api/v1/equipcare/import
 *
 * Prerequisites:
 *   1) EC_API_URL + EC_API_SERVICE_KEY set
 *   2) EC_SPREADSHEET_ID = Google Sheet converted from Db Tables.xlsx
 *   3) Run migrateEquipCareApi() once (tables + Standard asset view)
 *   4) Run importAllDbTablesToApi() (Main + related tabs) or importAssetsMainOnlyToApi()
 */

function sheetCellStr_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss");
  }
  return v == null ? '' : String(v);
}

function col_(map, row, name) {
  if (map[name] === undefined) return '';
  return row[map[name]];
}

function importChunk_(kind, rows) {
  if (!rows || !rows.length) return { ok: true, kind: kind, count: 0, sent: 0 };
  var batchSize = 25;
  var total = 0;
  var sent = 0;
  var errors = [];
  for (var i = 0; i < rows.length; i += batchSize) {
    var slice = rows.slice(i, i + batchSize);
    sent += slice.length;
    try {
      var res = ecApiPost_('/api/v1/equipcare/import', { kind: kind, rows: slice });
      total += res && res.count != null ? Number(res.count) : slice.length;
      if (res && res.errors && res.errors.length) {
        for (var e = 0; e < res.errors.length; e++) errors.push(res.errors[e]);
      }
    } catch (batchErr) {
      // Fall back to one-row posts so one bad row does not drop the batch.
      for (var j = 0; j < slice.length; j++) {
        try {
          var one = ecApiPost_('/api/v1/equipcare/import', { kind: kind, rows: [slice[j]] });
          total += one && one.count != null ? Number(one.count) : 1;
        } catch (rowErr) {
          errors.push({
            row: i + j + 2,
            error: rowErr && rowErr.message ? rowErr.message : String(rowErr)
          });
        }
      }
      if (!errors.length) {
        errors.push({
          batch: i,
          error: batchErr && batchErr.message ? batchErr.message : String(batchErr)
        });
      }
    }
  }
  return {
    ok: errors.length === 0,
    kind: kind,
    count: total,
    sent: sent,
    errorCount: errors.length,
    errors: errors.slice(0, 20)
  };
}

function truncateAssetsTable_(table) {
  return ecApiPost_('/api/v1/equipcare/import', {
    kind: 'assets_truncate',
    rows: [{ table: table }]
  });
}

function importUsersFromSheet_() {
  var sh = getSs_().getSheetByName(SH_USERS);
  if (!sh || sh.getLastRow() < 2) return importChunk_('users', []);
  var map = headerMap_(sh);
  var data = getRowsFrom2_(sh);
  var rows = [];
  for (var i = 0; i < data.length; i++) {
    var email = String(col_(map, data[i], 'Email') || '')
      .trim()
      .toLowerCase();
    if (!email) continue;
    rows.push({
      email: email,
      role: String(col_(map, data[i], 'Role') || ROLE_FIELD),
      displayName: String(col_(map, data[i], 'DisplayName') || email),
      active: String(col_(map, data[i], 'Active') || 'Yes').toLowerCase() !== 'no',
      userType: String(col_(map, data[i], 'UserType') || USER_TYPE_INTERNAL)
    });
  }
  return importChunk_('users', rows);
}

function importAssetsFromSheet_() {
  var sh = getSs_().getSheetByName('Main') || getSs_().getSheetByName(SH_ASSETS);
  if (!sh) return { ok: false, kind: 'assets_main', count: 0, error: 'Main sheet not found' };
  var map = headerMap_(sh);
  var data = getRowsFrom2_(sh);
  var rows = [];
  var skippedEmpty = 0;
  for (var i = 0; i < data.length; i++) {
    if (!sheetHasAnyValue_(data[i])) {
      skippedEmpty++;
      continue;
    }
    var assetId = parseSheetAssetId_(
      map['AssetID'] !== undefined
        ? data[i][map['AssetID']]
        : map['AssetId'] !== undefined
          ? data[i][map['AssetId']]
          : null
    );
    var num = String(
      map['Asset Number'] !== undefined
        ? data[i][map['Asset Number']]
        : map['AssetNumber'] !== undefined
          ? data[i][map['AssetNumber']]
          : ''
    ).trim();
    // Import every non-empty Main row. If AssetID is missing, API assigns next id when number present.
    if (assetId == null && !num) {
      // Still import if other identity fields exist — invent temporary number from row index.
      num = 'ROW-' + (i + 2);
    }
    var category = String(
      map['Category'] !== undefined
        ? data[i][map['Category']]
        : map['AssetType'] !== undefined
          ? data[i][map['AssetType']]
          : ''
    );
    var status = String(
      map['Status'] !== undefined
        ? data[i][map['Status']]
        : map['Active'] !== undefined
          ? String(data[i][map['Active']] || 'Yes').toLowerCase() === 'no'
            ? 'Retired'
            : 'Active'
          : 'Active'
    );
    var row = {
      assetNumber: num,
      capitalToolNumber: String(col_(map, data[i], 'Capital Tool Number') || ''),
      category: category,
      subCategory: String(col_(map, data[i], 'Sub Category') || ''),
      status: status,
      description: String(col_(map, data[i], 'Description') || ''),
      make: String(col_(map, data[i], 'Make') || ''),
      model: String(col_(map, data[i], 'Model') || ''),
      year: sheetCellStr_(col_(map, data[i], 'Year')),
      vinSerial: String(
        map['Serial Number/VIN'] !== undefined
          ? data[i][map['Serial Number/VIN']]
          : col_(map, data[i], 'VinSerial') || ''
      ),
      licensed: String(col_(map, data[i], 'Licensed?') || ''),
      plateNumber: String(
        map['License Plate #'] !== undefined
          ? data[i][map['License Plate #']]
          : col_(map, data[i], 'PlateNumber') || ''
      ),
      maxPmIntervalDays: sheetCellStr_(
        col_(map, data[i], 'Max Preventive Maintenance Interval Days')
      ),
      maxPmHoursMileage: sheetCellStr_(
        col_(map, data[i], 'Max Preventive Maintenance Hours/Mileage')
      ),
      notes: String(col_(map, data[i], 'Notes') || ''),
      assetType: category
    };
    if (assetId != null) row.assetId = assetId;
    rows.push(row);
  }
  var result = importChunk_('assets_main', rows);
  result.sheetRows = data.length;
  result.skippedEmpty = skippedEmpty;
  result.prepared = rows.length;
  return result;
}

function importPurchaseAndSoldFromSheet_() {
  var sh = getSs_().getSheetByName('PurchaseAndSold');
  if (!sh) return { ok: true, kind: 'assets_purchase_and_sold', count: 0, note: 'tab missing' };
  var map = headerMap_(sh);
  var data = getRowsFrom2_(sh);
  var rows = [];
  for (var i = 0; i < data.length; i++) {
    if (!sheetHasAnyValue_(data[i])) continue;
    var assetId = parseSheetAssetId_(col_(map, data[i], 'AssetID'));
    if (assetId == null) continue;
    rows.push({
      assetId: assetId,
      purchasedDate: sheetCellStr_(col_(map, data[i], 'Purchased Date')),
      purchasePrice: sheetCellStr_(col_(map, data[i], 'Purchase Price')),
      linkToPurchaseDocs: String(col_(map, data[i], 'Link to Purchase Documents') || ''),
      marketValue: sheetCellStr_(col_(map, data[i], 'Market Value')),
      listedForSale: sheetCellStr_(col_(map, data[i], 'Listed For Sale')),
      retiredSoldDate: sheetCellStr_(col_(map, data[i], 'Retired/Sold Date')),
      meterAtPurchase: sheetCellStr_(col_(map, data[i], 'Meter Hours/Mileage at Purchase'))
    });
  }
  return importChunk_('assets_purchase_and_sold', rows);
}

function importAssignmentFromSheet_() {
  var sh = getSs_().getSheetByName('Assignment');
  if (!sh) return { ok: true, kind: 'assets_assignment', count: 0, note: 'tab missing' };
  var map = headerMap_(sh);
  var data = getRowsFrom2_(sh);
  var rows = [];
  for (var i = 0; i < data.length; i++) {
    if (!sheetHasAnyValue_(data[i])) continue;
    var assetId = parseSheetAssetId_(col_(map, data[i], 'AssetID'));
    if (assetId == null) continue;
    rows.push({
      assetId: assetId,
      lastAssignedId: sheetCellStr_(col_(map, data[i], 'LastAssignedID')),
      assignedDate: sheetCellStr_(col_(map, data[i], 'Assigned Date')),
      employee: String(col_(map, data[i], 'Employee') || ''),
      location: String(col_(map, data[i], 'Location') || ''),
      project: String(col_(map, data[i], 'Project') || ''),
      outsideOfProjectArea: String(col_(map, data[i], 'Ouside of Project Area') || '')
    });
  }
  return importChunk_('assets_assignment', rows);
}

function importHistoricalAssignmentFromSheet_() {
  var sh = getSs_().getSheetByName('HistoricalAssignment');
  if (!sh) return { ok: true, kind: 'assets_historical_assignment', count: 0, note: 'tab missing' };
  truncateAssetsTable_('historical_assignment');
  var map = headerMap_(sh);
  var data = getRowsFrom2_(sh);
  var rows = [];
  for (var i = 0; i < data.length; i++) {
    if (!sheetHasAnyValue_(data[i])) continue;
    var assetId = parseSheetAssetId_(col_(map, data[i], 'AssetID'));
    if (assetId == null) continue;
    rows.push({
      assignedId: sheetCellStr_(col_(map, data[i], 'AssignedID')),
      assetId: assetId,
      startAssignedDate: sheetCellStr_(col_(map, data[i], 'Start Assigned Date')),
      endAssignedDate: sheetCellStr_(col_(map, data[i], 'End Assigned Date')),
      employee: String(col_(map, data[i], 'Employee') || ''),
      location: String(col_(map, data[i], 'Location') || ''),
      project: String(col_(map, data[i], 'Project') || ''),
      outsideOfProjectArea: String(col_(map, data[i], 'Ouside of Project Area') || '')
    });
  }
  return importChunk_('assets_historical_assignment', rows);
}

function importActiveEmployeesFromSheet_() {
  var sh = getSs_().getSheetByName('ActiveEmployees');
  if (!sh) return { ok: true, kind: 'assets_active_employees', count: 0, note: 'tab missing' };
  truncateAssetsTable_('active_employees');
  var map = headerMap_(sh);
  var data = getRowsFrom2_(sh);
  var rows = [];
  // Header cell is often the literal "Not Assigned"; also accept Username / Employee.
  var key =
    map['Username'] !== undefined
      ? 'Username'
      : map['Employee'] !== undefined
        ? 'Employee'
        : map['Not Assigned'] !== undefined
          ? 'Not Assigned'
          : Object.keys(map)[0];
  for (var i = 0; i < data.length; i++) {
    if (!sheetHasAnyValue_(data[i])) continue;
    var username = String(key ? col_(map, data[i], key) : data[i][0] || '').trim();
    if (!username) continue;
    rows.push({ username: username });
  }
  return importChunk_('assets_active_employees', rows);
}

function importEquipmentTypesFromSheet_() {
  var sh = getSs_().getSheetByName(SH_EQUIPMENT_TYPES);
  if (!sh || sh.getLastRow() < 2) return importChunk_('equipmentTypes', []);
  var map = headerMap_(sh);
  var data = getRowsFrom2_(sh);
  var rows = [];
  for (var i = 0; i < data.length; i++) {
    var name = String(col_(map, data[i], 'TypeName') || col_(map, data[i], 'Category') || '').trim();
    if (!name) continue;
    rows.push({ typeName: name });
  }
  return importChunk_('equipmentTypes', rows);
}

function importAuditsFromSheet_() {
  var sh = getSs_().getSheetByName(SH_AUDITS);
  if (!sh || sh.getLastRow() < 2) return importChunk_('audits', []);
  var map = headerMap_(sh);
  var data = getRowsFrom2_(sh);
  var rows = [];
  for (var i = 0; i < data.length; i++) {
    var id = String(col_(map, data[i], 'AuditId') || '').trim();
    if (!id) continue;
    rows.push({
      auditId: id,
      assetNumber: String(col_(map, data[i], 'AssetNumber') || '').trim(),
      performedByEmail: String(col_(map, data[i], 'PerformedByEmail') || ''),
      dateAudited: sheetCellStr_(col_(map, data[i], 'DateAudited')),
      meterReading: sheetCellStr_(col_(map, data[i], 'MeterReading')),
      condition: String(col_(map, data[i], 'Condition') || 'N/A'),
      housekeeping: String(col_(map, data[i], 'Housekeeping') || 'N/A'),
      mechanicalItems: String(col_(map, data[i], 'MechanicalItems') || 'N/A'),
      safetyItems: String(col_(map, data[i], 'SafetyItems') || 'N/A'),
      documents: String(col_(map, data[i], 'Documents') || 'N/A'),
      conditionNotes: String(col_(map, data[i], 'ConditionNotes') || ''),
      mechanicalNotes: String(col_(map, data[i], 'MechanicalNotes') || ''),
      safetyNotes: String(col_(map, data[i], 'SafetyNotes') || ''),
      otherNotes: String(col_(map, data[i], 'OtherNotes') || ''),
      equipmentType: String(col_(map, data[i], 'EquipmentType') || ''),
      status: String(col_(map, data[i], 'Status') || 'Complete'),
      auditType: String(col_(map, data[i], 'AuditType') || AUDIT_TYPE_INTERNAL),
      usageFormId: String(col_(map, data[i], 'UsageFormId') || ''),
      createdAt: sheetCellStr_(col_(map, data[i], 'CreatedAt'))
    });
  }
  return importChunk_('audits', rows);
}

function importPhotosFromSheet_() {
  var sh = getSs_().getSheetByName(SH_AUDIT_PHOTOS);
  if (!sh || sh.getLastRow() < 2) return importChunk_('photos', []);
  var map = headerMap_(sh);
  var data = getRowsFrom2_(sh);
  var rows = [];
  for (var i = 0; i < data.length; i++) {
    var photoId = String(col_(map, data[i], 'PhotoId') || '').trim();
    var auditId = String(col_(map, data[i], 'AuditId') || '').trim();
    if (!photoId || !auditId) continue;
    rows.push({
      photoId: photoId,
      auditId: auditId,
      category: String(col_(map, data[i], 'Category') || ''),
      equipmentType: String(col_(map, data[i], 'EquipmentType') || ''),
      driveFileId: String(col_(map, data[i], 'DriveFileId') || ''),
      url: String(col_(map, data[i], 'Url') || ''),
      uploadedAt: sheetCellStr_(col_(map, data[i], 'UploadedAt')),
      notes: String(col_(map, data[i], 'Notes') || ''),
      metaDateTime: String(col_(map, data[i], 'MetaDateTime') || ''),
      metaLat: String(col_(map, data[i], 'MetaLat') || ''),
      metaLng: String(col_(map, data[i], 'MetaLng') || '')
    });
  }
  return importChunk_('photos', rows);
}

function importAiReviewsFromSheet_() {
  var sh = getSs_().getSheetByName(SH_AI_REVIEWS);
  if (!sh || sh.getLastRow() < 2) return importChunk_('aiReviews', []);
  var map = headerMap_(sh);
  var data = getRowsFrom2_(sh);
  var rows = [];
  for (var i = 0; i < data.length; i++) {
    var reviewId = String(col_(map, data[i], 'ReviewId') || '').trim();
    if (!reviewId) continue;
    rows.push({
      reviewId: reviewId,
      assetNumber: String(col_(map, data[i], 'AssetNumber') || '').trim(),
      triggerAuditId: String(col_(map, data[i], 'TriggerAuditId') || ''),
      createdAt: sheetCellStr_(col_(map, data[i], 'CreatedAt')),
      model: String(col_(map, data[i], 'Model') || ''),
      summaryText: String(col_(map, data[i], 'SummaryText') || '')
    });
  }
  return importChunk_('aiReviews', rows);
}

function importUsageFormsFromSheet_() {
  var sh = getSs_().getSheetByName(SH_USAGE_FORMS);
  if (!sh || sh.getLastRow() < 2) return importChunk_('usageForms', []);
  var map = headerMap_(sh);
  var data = getRowsFrom2_(sh);
  var rows = [];
  for (var i = 0; i < data.length; i++) {
    var id = String(col_(map, data[i], 'UsageFormId') || '').trim();
    var assetNumber = String(col_(map, data[i], 'AssetNumber') || '').trim();
    var userEmail = String(col_(map, data[i], 'UserEmail') || '').trim();
    if (!assetNumber || !userEmail) continue;
    rows.push({
      usageFormId: id,
      assetNumber: assetNumber,
      userEmail: userEmail,
      companyName: String(col_(map, data[i], 'CompanyName') || ''),
      agreementRef: String(col_(map, data[i], 'AgreementRef') || ''),
      termStart: sheetCellStr_(col_(map, data[i], 'TermStart')),
      termEnd: sheetCellStr_(col_(map, data[i], 'TermEnd')),
      status: String(col_(map, data[i], 'Status') || 'Draft'),
      createdBy: String(col_(map, data[i], 'CreatedBy') || ''),
      notes: String(col_(map, data[i], 'Notes') || '')
    });
  }
  return importChunk_('usageForms', rows);
}

function importKitItemsFromSheet_() {
  var sh = getSs_().getSheetByName(SH_USAGE_KIT_ITEMS);
  if (!sh || sh.getLastRow() < 2) return importChunk_('kitItems', []);
  var map = headerMap_(sh);
  var data = getRowsFrom2_(sh);
  var rows = [];
  for (var i = 0; i < data.length; i++) {
    var kid = String(col_(map, data[i], 'KitItemId') || '').trim();
    var uf = String(col_(map, data[i], 'UsageFormId') || '').trim();
    var name = String(col_(map, data[i], 'ItemName') || '').trim();
    if (!uf || !name) continue;
    rows.push({
      kitItemId: kid || Utilities.getUuid(),
      usageFormId: uf,
      itemName: name,
      quantityIssued: col_(map, data[i], 'QuantityIssued') || 1,
      unit: String(col_(map, data[i], 'Unit') || 'ea'),
      serialOrTag: String(col_(map, data[i], 'SerialOrTag') || ''),
      verifyOnWeekly: col_(map, data[i], 'VerifyOnWeekly'),
      verifyOnReturn: col_(map, data[i], 'VerifyOnReturn'),
      sortOrder: col_(map, data[i], 'SortOrder') || 0,
      active: col_(map, data[i], 'Active'),
      notes: String(col_(map, data[i], 'Notes') || '')
    });
  }
  return importChunk_('kitItems', rows);
}

/**
 * Import every active Db Tables tab into vc.assets_* (skips *-Old / Scratch).
 * Run after migrateEquipCareApi(). Safe to re-run (upserts / reload append-only tabs).
 */
function importAllDbTablesToApi() {
  requireEcApiConfigured_();
  var migrate = migrateEquipCareApi();
  var results = [{ ok: true, kind: 'migrate', steps: migrate.steps || migrate }];
  var kinds = [
    ['assets_main', importAssetsFromSheet_],
    ['assets_purchase_and_sold', importPurchaseAndSoldFromSheet_],
    ['assets_assignment', importAssignmentFromSheet_],
    ['assets_historical_assignment', importHistoricalAssignmentFromSheet_],
    ['assets_active_employees', importActiveEmployeesFromSheet_]
  ];
  for (var i = 0; i < kinds.length; i++) {
    try {
      results.push(kinds[i][1]());
    } catch (e) {
      results.push({
        ok: false,
        kind: kinds[i][0],
        error: e && e.message ? e.message : String(e)
      });
    }
  }
  return results;
}

/** Import only Main → vc.assets_main (all non-empty rows). */
function importAssetsMainOnlyToApi() {
  requireEcApiConfigured_();
  migrateEquipCareApi();
  return importAssetsFromSheet_();
}

/** Legacy entry — EquipCare ops sheets + Db Tables assets tabs. */
function importAllEquipCareSheetsToApi() {
  requireEcApiConfigured_();
  migrateEquipCareApi();
  var results = [];
  var kinds = [
    ['users', importUsersFromSheet_],
    ['equipmentTypes', importEquipmentTypesFromSheet_],
    ['assets_main', importAssetsFromSheet_],
    ['assets_purchase_and_sold', importPurchaseAndSoldFromSheet_],
    ['assets_assignment', importAssignmentFromSheet_],
    ['assets_historical_assignment', importHistoricalAssignmentFromSheet_],
    ['assets_active_employees', importActiveEmployeesFromSheet_],
    ['audits', importAuditsFromSheet_],
    ['photos', importPhotosFromSheet_],
    ['aiReviews', importAiReviewsFromSheet_],
    ['usageForms', importUsageFormsFromSheet_],
    ['kitItems', importKitItemsFromSheet_]
  ];
  for (var i = 0; i < kinds.length; i++) {
    try {
      results.push(kinds[i][1]());
    } catch (e) {
      results.push({
        ok: false,
        kind: kinds[i][0],
        error: e && e.message ? e.message : String(e)
      });
    }
  }
  return results;
}

/** Quick smoke: ping + list assets (requires props + deployed API with migrate). */
function smokeTestEquipCareApi() {
  requireEcApiConfigured_();
  var ping = pingEquipCareApi();
  var migrate = migrateEquipCareApi();
  var assets = ecApiGet_('/api/v1/equipcare/assets');
  return {
    ok: true,
    ping: ping,
    migrateSteps: migrate.steps || migrate,
    assetCount: ((assets && assets.assets) || []).length,
    baseUrl: getEcApiBaseUrl_()
  };
}
