/**
 * Usage Form + kit — VeloxInternal-API backed.
 */

function listUsageForms_(filters) {
  var q = ecBuildQuery_(filters || {});
  var res = ecApiGet_('/api/v1/equipcare/usage-forms' + q);
  return (res && res.usageForms) || [];
}

function getUsageFormById_(usageFormId) {
  var res = ecApiGet_('/api/v1/equipcare/usage-forms/' + encodeURIComponent(String(usageFormId || '').trim()));
  return res && res.usageForm ? res.usageForm : null;
}

function listKitItemsForUsageForm_(usageFormId) {
  var res = ecApiGet_('/api/v1/equipcare/usage-forms/' + encodeURIComponent(String(usageFormId || '').trim()));
  return (res && res.kitItems) || [];
}

function saveUsageForm_(payload, actorEmail) {
  var p = payload || {};
  var id = String(p.usageFormId || '').trim();
  if (id) {
    var res = ecApiPut_('/api/v1/equipcare/usage-forms/' + encodeURIComponent(id), p);
    return res && res.usageForm;
  }
  var created = ecApiPost_('/api/v1/equipcare/usage-forms', p);
  return created && created.usageForm;
}

function replaceKitItems_(usageFormId, items) {
  var res = ecApiPut_(
    '/api/v1/equipcare/usage-forms/' + encodeURIComponent(String(usageFormId || '').trim()) + '/kit',
    { kitItems: items || [] }
  );
  return (res && res.kitItems) || [];
}

function listUsers_() {
  var res = ecApiGet_('/api/v1/equipcare/users');
  return (res && res.users) || [];
}

function saveUser_(payload) {
  var p = payload || {};
  var email = String(p.email || '')
    .trim()
    .toLowerCase();
  var res = ecApiPut_('/api/v1/equipcare/users/' + encodeURIComponent(email), {
    email: email,
    role: p.role,
    displayName: p.displayName,
    active: p.active,
    userType: p.userType
  });
  return userFromApi_(res && res.user);
}

function seedSampleUsageForm(assetNumber, assigneeEmail) {
  requireEcApiConfigured_();
  assetNumber = String(assetNumber || '').trim();
  if (!assetNumber) {
    var assets = listAssets_();
    if (!assets || !assets.length) {
      throw new Error('No assets found. Add an asset first, or pass assetNumber.');
    }
    assetNumber = assets[0].assetNumber;
  }
  var email = String(assigneeEmail || Session.getActiveUser().getEmail() || '')
    .trim()
    .toLowerCase();
  if (!email) throw new Error('Assignee email required.');

  var uf = saveUsageForm_({
    assetNumber: assetNumber,
    userEmail: email,
    companyName: 'Sample Contractor LLC',
    agreementRef: 'SAMPLE-AGREEMENT',
    termStart: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    status: USAGE_STATUS_DRAFT,
    notes: 'Sample Usage Form — safe to delete.'
  });

  replaceKitItems_(uf.usageFormId, [
    { itemName: 'Drill pipe / rod', quantityIssued: 50, unit: 'ea', verifyOnWeekly: true, verifyOnReturn: true, sortOrder: 10 },
    { itemName: 'Drill head', quantityIssued: 1, unit: 'ea', verifyOnWeekly: true, verifyOnReturn: true, sortOrder: 20 },
    { itemName: 'Locator', quantityIssued: 1, unit: 'ea', verifyOnWeekly: true, verifyOnReturn: true, sortOrder: 30 },
    { itemName: 'Sonde', quantityIssued: 1, unit: 'ea', verifyOnWeekly: true, verifyOnReturn: true, sortOrder: 40 },
    { itemName: 'Water tank', quantityIssued: 1, unit: 'ea', verifyOnWeekly: false, verifyOnReturn: true, sortOrder: 50 }
  ]);

  return (
    'Sample Usage Form ' +
    uf.usageFormId +
    ' for asset ' +
    assetNumber +
    ' assigned to ' +
    email +
    ' (Status=Draft, 5 kit lines).'
  );
}

function apiListUsageForms(filters) {
  try {
    var u = requireRegisteredUser_();
    if (!isManagerOrAdmin_(u)) throw new Error('Only Admin or Manager can list Usage Forms.');
    return { ok: true, usageForms: listUsageForms_(filters || {}) };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function apiGetUsageForm(usageFormId) {
  try {
    var u = requireRegisteredUser_();
    if (!isManagerOrAdmin_(u)) throw new Error('Only Admin or Manager can view Usage Forms.');
    var res = ecApiGet_(
      '/api/v1/equipcare/usage-forms/' + encodeURIComponent(String(usageFormId || '').trim())
    );
    return {
      ok: true,
      usageForm: res.usageForm,
      kitItems: res.kitItems || []
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function apiSaveUsageForm(payload) {
  try {
    var u = requireRegisteredUser_();
    if (!isManagerOrAdmin_(u)) throw new Error('Only Admin or Manager can save Usage Forms.');
    var uf = saveUsageForm_(payload || {}, u.email);
    return { ok: true, usageForm: uf };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function apiReplaceKitItems(usageFormId, items) {
  try {
    var u = requireRegisteredUser_();
    if (!isManagerOrAdmin_(u)) throw new Error('Only Admin or Manager can edit kit items.');
    return { ok: true, kitItems: replaceKitItems_(usageFormId, items || []) };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function apiListUsers() {
  try {
    var u = requireRegisteredUser_();
    if (!isAdmin_(u)) throw new Error('Only Admin can list users.');
    return { ok: true, users: listUsers_() };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function apiSaveUser(payload) {
  try {
    var u = requireRegisteredUser_();
    if (!isAdmin_(u)) throw new Error('Only Admin can create or edit users.');
    var saved = saveUser_(payload || {});
    return {
      ok: true,
      user: saved
        ? {
            email: saved.email,
            role: saved.role,
            displayName: saved.displayName,
            active: saved.active,
            userType: saved.userType
          }
        : null
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}
