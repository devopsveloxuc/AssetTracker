function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/**
 * Run once from the Apps Script editor (as the web-app deployer) to approve
 * UrlFetch / Drive scopes. Web app executes as USER_DEPLOYING, so only this
 * account needs to authorize — end users do not.
 */
function authorizeEquipCareScopes() {
  UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true });
  DriveApp.getRootFolder();
  Session.getActiveUser().getEmail();
  return 'EquipCare scopes authorized for ' + (Session.getEffectiveUser().getEmail() || '');
}

/** Apps Script setFaviconUrl needs https…png; host embedded base64 favicon on Drive once. */
var EC_FAVICON_REVISION_ = '1-base64';

function ensureEquipCareFaviconOnDrive_() {
  var p = PropertiesService.getScriptProperties();
  var revision = EC_FAVICON_REVISION_;
  var cachedRev = String(p.getProperty('EC_FAVICON_REVISION') || '').trim();
  var cached = String(p.getProperty('EC_FAVICON_URL') || '').trim();
  if (cached && cachedRev === revision) return cached;

  var dataUrl = '';
  try {
    dataUrl = getVeloxFaviconDataUrl_() || '';
  } catch (e) {
    dataUrl = '';
  }
  var m = String(dataUrl).match(/^data:image\/png;base64,(.+)$/i);
  if (!m) return '';

  var blob = Utilities.newBlob(
    Utilities.base64Decode(m[1]),
    MimeType.PNG,
    'velox-equipcare-favicon.png'
  );
  var fileId = String(p.getProperty('EC_FAVICON_DRIVE_ID') || '').trim();
  var file;
  if (fileId) {
    try {
      file = DriveApp.getFileById(fileId);
      file.setContent(blob.getBytes());
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (driveErr) {
      file = DriveApp.createFile(blob);
    }
  } else {
    file = DriveApp.createFile(blob);
  }
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  fileId = file.getId();
  var url = 'https://lh3.googleusercontent.com/d/' + fileId + '#.png';
  p.setProperty('EC_FAVICON_DRIVE_ID', fileId);
  p.setProperty('EC_FAVICON_URL', url);
  p.setProperty('EC_FAVICON_REVISION', revision);
  return url;
}

/**
 * Tab favicon for HtmlOutput.setFaviconUrl (must be https…png, not data:).
 * Source image is always the embedded base64 in LogoData.gs.
 */
function getEquipCareFaviconUrl_() {
  var p = PropertiesService.getScriptProperties();
  var manual = String(p.getProperty('EC_FAVICON_URL_OVERRIDE') || '').trim();
  if (manual) return manual;
  try {
    var hosted = ensureEquipCareFaviconOnDrive_();
    if (hosted) return hosted;
  } catch (e) {}
  return '';
}

function doGet(e) {
  e = e || {};
  var page = '';
  var initialAsset = '';
  var initialAssetId = '';
  try {
    page = String((e.parameter && e.parameter.page) || '').trim().toLowerCase();
    initialAsset = String((e.parameter && e.parameter.asset) || '').trim();
    initialAssetId = String((e.parameter && e.parameter.assetId) || '').trim();
  } catch (paramErr) {
    page = '';
    initialAsset = '';
    initialAssetId = '';
  }

  var templateName = 'Index';
  var pageTitle = 'Asset Management';
  if (page === 'assign') {
    templateName = 'AssignmentPage';
    pageTitle = 'Assign Asset';
  } else if (page === 'audit') {
    templateName = 'AuditPage';
    pageTitle = 'EquipCare AI';
  }
  var t = HtmlService.createTemplateFromFile(templateName);
  var output = t
    .evaluate()
    .setTitle(pageTitle)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  var html = output.getContent();
  var headerLogo = '';
  try {
    headerLogo = getVeloxHeaderLogoDataUrl_() || '';
  } catch (err) {
    headerLogo = '';
  }
  // In-app logos are base64 data URLs only (no remote logo URLs).
  html = html.replace(/__HEADER_LOGO_URL__/g, headerLogo);
  html = html.replace(/__INITIAL_ASSET_JSON__/g, JSON.stringify(initialAsset));
  html = html.replace(/__INITIAL_ASSET_ID_JSON__/g, JSON.stringify(initialAssetId));
  html = html.replace(/__PAGE_MODE_JSON__/g, JSON.stringify(page || ''));
  output.setContent(html);
  try {
    var faviconUrl = getEquipCareFaviconUrl_();
    if (faviconUrl) output.setFaviconUrl(faviconUrl);
  } catch (favErr) {}
  return output;
}

function getWebAppUrl_() {
  try {
    var url = ScriptApp.getService().getUrl();
    if (url) return String(url).trim();
  } catch (e) {}
  return String(PropertiesService.getScriptProperties().getProperty('EC_WEBAPP_URL') || '').trim();
}

function apiBootstrap() {
  try {
    requireEcApiConfigured_();
    var email = requireUserEmail_();
    var u = findUserRow_(email);
    var canManage = !!(u && u.active && isManagerOrAdmin_(u));
    return {
      ok: true,
      email: email,
      user: u
        ? {
            role: u.role,
            displayName: u.displayName,
            active: u.active,
            userType: u.userType || USER_TYPE_INTERNAL
          }
        : null,
      canManageAssets: canManage,
      canManageUsers: !!(u && u.active && isAdmin_(u)),
      needsRegistration: !u || !u.active,
      webAppUrl: getWebAppUrl_()
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function apiListAssets() {
  try {
    requireRegisteredUser_();
    return { ok: true, assets: listAssets_() };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function apiSaveAsset(payload) {
  try {
    var u = requireRegisteredUser_();
    if (!isManagerOrAdmin_(u)) {
      throw new Error('Only Admin or Manager can create or edit assets.');
    }
    var res = saveAsset_(payload || {});
    return { ok: true, assetNumber: res.assetNumber, assetId: res.assetId };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function apiDeleteAsset(payload) {
  try {
    var u = requireRegisteredUser_();
    if (!isManagerOrAdmin_(u)) {
      throw new Error('Only Admin or Manager can delete assets.');
    }
    var res = deleteAsset_(payload || {});
    return {
      ok: true,
      assetNumber: res && res.assetNumber,
      assetId: res && res.assetId
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function apiGetAssetDetail(payload) {
  try {
    requireRegisteredUser_();
    var p = payload || {};
    var detail = getAssetDetail_(p.assetId);
    return { ok: true, detail: detail };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function apiListAssignmentHistory(payload) {
  try {
    requireRegisteredUser_();
    var p = payload || {};
    return { ok: true, history: listAssignmentHistory_(p.assetId) };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function apiListActiveEmployees() {
  try {
    requireRegisteredUser_();
    return { ok: true, employees: listActiveEmployees_() };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function apiReplaceAssignment(payload) {
  try {
    var u = requireRegisteredUser_();
    if (!isManagerOrAdmin_(u)) {
      throw new Error('Only Admin or Manager can assign assets.');
    }
    var res = replaceAssignment_(payload || {});
    return {
      ok: true,
      assetId: res && res.assetId,
      assetNumber: res && res.assetNumber,
      assignment: res && res.assignment,
      historyEntry: res && res.historyEntry
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function createDraftAuditForAsset_(assetNumber) {
  assetNumber = String(assetNumber || '').trim();
  if (!assetNumber) throw new Error('Asset number required.');
  var res = ecApiPost_('/api/v1/equipcare/audits', {
    draft: true,
    assetNumber: assetNumber
  });
  return res.auditId;
}

function apiSaveAudit(payload) {
  try {
    requireRegisteredUser_();
    var p = payload || {};
    var eqReq = String(p.equipmentType || '').trim();
    if (!eqReq) throw new Error('Select an equipment type before saving the inspection.');
    if (!p.auditType) p.auditType = AUDIT_TYPE_INTERNAL;
    var res = ecApiPost_('/api/v1/equipcare/audits', p);
    return { ok: true, auditId: res.auditId };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

/**
 * Run once from the Apps Script editor after EC_API_* properties are set.
 * Adds an Admin user in Postgres for the given email.
 */
function seedEcAdminUser(email) {
  email = String(email || Session.getActiveUser().getEmail() || '')
    .trim()
    .toLowerCase();
  if (!email) throw new Error('Email required');
  requireEcApiConfigured_();
  migrateEquipCareApi();
  ecApiPost_('/api/v1/equipcare/users', {
    email: email,
    role: ROLE_ADMIN,
    displayName: email,
    active: true,
    userType: USER_TYPE_INTERNAL
  });
  return 'Seeded/updated Admin via API: ' + email;
}

function apiListAuditsForAsset(assetNumber) {
  try {
    requireRegisteredUser_();
    assetNumber = String(assetNumber || '').trim();
    var res = ecApiGet_(
      '/api/v1/equipcare/assets/' + encodeURIComponent(assetNumber) + '/audits'
    );
    var audits = (res && res.audits) || [];
    var out = [];
    for (var i = 0; i < audits.length; i++) {
      var a = audits[i];
      out.push({
        auditId: a.auditId || '',
        performedBy: a.performedBy || a.performedByEmail || '',
        dateAudited: a.dateAudited || '',
        condition: a.condition || '',
        housekeeping: a.housekeeping || '',
        mechanicalItems: a.mechanicalItems || '',
        safetyItems: a.safetyItems || '',
        documents: a.documents || '',
        equipmentType: a.equipmentType || '',
        auditType: a.auditType || AUDIT_TYPE_INTERNAL,
        usageFormId: a.usageFormId || ''
      });
    }
    return { ok: true, audits: out };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function apiListEquipmentTypes() {
  try {
    requireRegisteredUser_();
    var res = ecApiGet_('/api/v1/equipcare/equipment-types');
    return { ok: true, types: (res && res.types) || [] };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function getAuditById_(auditId) {
  var res = ecApiGet_('/api/v1/equipcare/audits/' + encodeURIComponent(String(auditId || '').trim()));
  return res && res.audit ? res.audit : null;
}

function getPhotosForAuditId_(auditId) {
  var res = ecApiGet_(
    '/api/v1/equipcare/audits/' + encodeURIComponent(String(auditId || '').trim()) + '/photos'
  );
  return (res && res.photos) || [];
}

function escapeHtmlReport_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

var EC_REPORT_PHOTO_EMBED_MAX_BYTES = 2 * 1024 * 1024;

function photoInlineSrcForReport_(driveFileId) {
  driveFileId = String(driveFileId || '').trim();
  if (!driveFileId) return '';
  try {
    var file = DriveApp.getFileById(driveFileId);
    var blob = file.getBlob();
    var bytes = blob.getBytes();
    if (!bytes || bytes.length > EC_REPORT_PHOTO_EMBED_MAX_BYTES) return '';
    var ct = String(blob.getContentType() || 'image/jpeg').split(';')[0].trim();
    if (ct.indexOf('image/') !== 0) ct = 'image/jpeg';
    return 'data:' + ct + ';base64,' + Utilities.base64Encode(bytes);
  } catch (e) {
    return '';
  }
}

function getAiReviewsForTriggerAuditId_(auditId) {
  auditId = String(auditId || '').trim();
  if (!auditId) return [];
  var res = ecApiGet_(
    '/api/v1/equipcare/ai-reviews' + ecBuildQuery_({ triggerAuditId: auditId })
  );
  var reviews = (res && res.reviews) || [];
  var out = [];
  for (var i = 0; i < reviews.length; i++) {
    out.push({
      createdAt: reviews[i].createdAt || '',
      model: reviews[i].model || '',
      summary: reviews[i].summaryText || ''
    });
  }
  return out;
}

function getLatestAiReviewRowForAsset_(assetNumber) {
  assetNumber = String(assetNumber || '').trim();
  if (!assetNumber) return null;
  var res = ecApiGet_(
    '/api/v1/equipcare/ai-reviews' + ecBuildQuery_({ assetNumber: assetNumber })
  );
  var r = res && res.review;
  if (!r) return null;
  return {
    createdAt: r.createdAt || '',
    model: r.model || '',
    summary: r.summaryText || '',
    triggerAuditId: r.triggerAuditId || ''
  };
}

function pickAiReviewsForReport_(auditId, assetNumber) {
  var exact = getAiReviewsForTriggerAuditId_(auditId);
  if (exact.length) {
    return { rows: exact, banner: null };
  }
  var latest = getLatestAiReviewRowForAsset_(assetNumber);
  if (latest) {
    return {
      rows: [
        {
          createdAt: latest.createdAt,
          model: latest.model,
          summary: latest.summary
        }
      ],
      banner:
        'No AI row is stored for this exact inspection ID. Showing the latest AI review on file for this asset, from when inspection ' +
        (latest.triggerAuditId || '—') +
        ' was submitted.'
    };
  }
  return { rows: [], banner: null };
}

function buildInspectionReportHtml_(auditId) {
  var audit = getAuditById_(auditId);
  if (!audit) throw new Error('Inspection not found.');
  if (String(audit.status || '').toLowerCase() === 'draft') {
    throw new Error('Complete the inspection before generating a report.');
  }
  var assetNum = String(audit.assetNumber || '').trim();
  var photos = getPhotosForAuditId_(auditId);
  var assetDesc = '';
  try {
    var assets = listAssets_();
    for (var a = 0; a < assets.length; a++) {
      if (String(assets[a].assetNumber || '').trim() === assetNum) {
        assetDesc =
          (assets[a].description || '') +
          ' · Type: ' +
          (assets[a].category || assets[a].assetType || '—') +
          ' · Status: ' +
          (assets[a].status || '—');
        break;
      }
    }
  } catch (ignore) {}

  function cell(key) {
    return String(audit[key] != null ? audit[key] : '');
  }

  var html =
    '<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Inspection report</title>' +
    '<style>body{font-family:Segoe UI,system-ui,sans-serif;max-width:800px;margin:24px auto;padding:0 16px;color:#111}' +
    'h1{font-size:22px}h2{font-size:16px;margin-top:24px;border-bottom:1px solid #ccc;padding-bottom:6px}' +
    'table{border-collapse:collapse;width:100%;margin:12px 0}td{padding:6px 8px;border:1px solid #ddd}' +
    'td:first-child{width:38%;font-weight:600;background:#f6f8fa}.ph{display:flex;flex-wrap:wrap;gap:12px}' +
    '.ph div{width:220px;font-size:12px;color:#444}.ph img{max-width:220px;height:auto;border:1px solid #ccc}' +
    '.ai-section{margin-top:28px}.ai-block{margin:14px 0;padding:14px;background:#f6f8fa;border-left:4px solid #238636;border-radius:0 8px 8px 0}' +
    '.ai-block h3{margin:0 0 8px;font-size:15px}.ai-meta{font-size:12px;color:#555;margin-bottom:10px}' +
    '.ai-body{white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.5;color:#111}</style></head><body>';
  html += '<h1>EquipCare — Inspection report</h1>';
  html += '<p><strong>Asset</strong> ' + escapeHtmlReport_(assetNum) + '</p>';
  if (assetDesc) html += '<p class="meta">' + escapeHtmlReport_(assetDesc) + '</p>';
  html += '<h2>Summary</h2><table>';
  var summaryRows = [
    ['Inspection date', cell('dateAudited')],
    ['Performed by', cell('performedByEmail') || cell('performedBy')],
    ['Audit type', cell('auditType')],
    ['Equipment type (inspection)', cell('equipmentType')],
    ['Meter reading', cell('meterReading')],
    ['Condition', cell('condition')],
    ['Housekeeping', cell('housekeeping')],
    ['Mechanical', cell('mechanicalItems')],
    ['Safety', cell('safetyItems')],
    ['Documents', cell('documents')],
    ['Condition notes', cell('conditionNotes')],
    ['Mechanical notes', cell('mechanicalNotes')],
    ['Safety notes', cell('safetyNotes')],
    ['Other notes', cell('otherNotes')]
  ];
  for (var r = 0; r < summaryRows.length; r++) {
    html +=
      '<tr><td>' +
      escapeHtmlReport_(summaryRows[r][0]) +
      '</td><td>' +
      escapeHtmlReport_(summaryRows[r][1]) +
      '</td></tr>';
  }
  html += '</table><h2>Photos (' + photos.length + ')</h2>';
  if (!photos.length) {
    html += '<p>No photos for this inspection.</p>';
  } else {
    html +=
      '<p style="font-size:12px;color:#555;margin:0 0 12px">Images are embedded when size allows. Click any photo to open Drive.</p>';
    html += '<div class="ph">';
    for (var p = 0; p < photos.length; p++) {
      var ph = photos[p];
      var cap =
        (ph.equipmentType ? ph.equipmentType + ' · ' : '') +
        (ph.metaDateTime ? 'Camera: ' + ph.metaDateTime + ' · ' : '') +
        (ph.metaLat && ph.metaLng ? 'GPS: ' + ph.metaLat + ', ' + ph.metaLng + ' · ' : '') +
        'Uploaded: ' +
        (ph.uploadedAt || '');
      var inlineSrc = photoInlineSrcForReport_(ph.driveFileId);
      var imgSrc = inlineSrc || ph.url;
      html += '<div><a href="' + escapeHtmlReport_(ph.url) + '" target="_blank" rel="noopener">';
      html += '<img src="' + escapeHtmlReport_(imgSrc) + '" alt="Inspection photo"/></a><div>';
      html += escapeHtmlReport_(cap) + '</div></div>';
    }
    html += '</div>';
  }
  var aiEnsureDiag = null;
  try {
    aiEnsureDiag = maybeEnsureAiReviewForReport_(auditId, assetNum);
  } catch (e) {
    aiEnsureDiag = e.message || String(e);
  }
  var aiPick = pickAiReviewsForReport_(auditId, assetNum);
  var aiRows = aiPick.rows || [];
  html += '<div class="ai-section"><h2>AI review findings</h2>';
  if (aiPick.banner) {
    html +=
      '<p style="font-size:13px;color:#664d00;background:#fff8e6;padding:10px 12px;border-radius:8px;border:1px solid #e6d9a8;margin:0 0 14px">' +
      escapeHtmlReport_(aiPick.banner) +
      '</p>';
  }
  if (!aiRows.length) {
    if (aiEnsureDiag === '[NO_KEY]') {
      html +=
        '<p><strong>No OpenAI key for this deployment.</strong> Add script property <strong>EC_OPENAI_API_KEY</strong>, then redeploy the web app.</p>';
    } else if (aiEnsureDiag) {
      html +=
        '<p style="color:#7d1212;background:#fdeaea;padding:12px 14px;border-radius:8px;border:1px solid #f0b4b4"><strong>AI did not appear because:</strong> ' +
        escapeHtmlReport_(aiEnsureDiag) +
        '</p>';
    } else {
      html += '<p>No AI review is stored yet for this inspection or this asset.</p>';
    }
  } else {
    html +=
      '<p class="muted" style="font-size:13px;color:#555;margin:0 0 12px">Summaries use this inspection’s context plus prior completed inspections and sample photos.</p>';
    for (var ai = 0; ai < aiRows.length; ai++) {
      var ar = aiRows[ai];
      html += '<div class="ai-block">';
      html += '<h3>Review ' + (ai + 1) + (aiRows.length > 1 ? ' of ' + aiRows.length : '') + '</h3>';
      html +=
        '<div class="ai-meta">' +
        escapeHtmlReport_(ar.createdAt || '—') +
        (ar.model ? ' · Model: ' + escapeHtmlReport_(ar.model) : '') +
        '</div>';
      html += '<div class="ai-body">' + escapeHtmlReport_(ar.summary || '(empty)') + '</div>';
      html += '</div>';
    }
  }
  html += '</div>';
  html +=
    '<p style="margin-top:32px;font-size:12px;color:#666">Generated ' +
    new Date().toISOString() +
    '</p></body></html>';
  return html;
}

function apiGenerateInspectionReport(auditId) {
  try {
    requireRegisteredUser_();
    auditId = String(auditId || '').trim();
    if (!auditId) throw new Error('Missing inspection.');
    var html = buildInspectionReportHtml_(auditId);
    return { ok: true, html: html };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}
