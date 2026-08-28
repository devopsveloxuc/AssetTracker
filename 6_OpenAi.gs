/**
 * OpenAI vision + text review — data from VeloxInternal-API; photos from Drive.
 */

function collectRecentCompletedAuditsForAsset_(assetNumber, maxN) {
  maxN = maxN || 5;
  assetNumber = String(assetNumber || '').trim();
  var res = ecApiGet_(
    '/api/v1/equipcare/assets/' + encodeURIComponent(assetNumber) + '/audits'
  );
  var audits = (res && res.audits) || [];
  audits.sort(function (a, b) {
    return String(b.dateAudited || '').localeCompare(String(a.dateAudited || ''));
  });
  if (audits.length > maxN) audits = audits.slice(0, maxN);
  var hits = [];
  for (var i = 0; i < audits.length; i++) {
    hits.push({
      id: audits[i].auditId,
      audit: audits[i],
      date: audits[i].dateAudited
    });
  }
  return hits;
}

function auditObjToTextBlock_(a) {
  a = a || {};
  return (
    'AuditId: ' +
    (a.auditId || '') +
    '\nDate audited: ' +
    (a.dateAudited || '') +
    '\nEquipment type: ' +
    (a.equipmentType || '') +
    '\nGrades — Condition: ' +
    (a.condition || '') +
    ', Housekeeping: ' +
    (a.housekeeping || '') +
    ', Mechanical: ' +
    (a.mechanicalItems || '') +
    ', Safety: ' +
    (a.safetyItems || '') +
    ', Documents: ' +
    (a.documents || '') +
    '\nNotes — Condition: ' +
    (a.conditionNotes || '') +
    '\nMechanical: ' +
    (a.mechanicalNotes || '') +
    '\nSafety: ' +
    (a.safetyNotes || '') +
    '\nOther: ' +
    (a.otherNotes || '')
  );
}

function formatAuditDateForCaption_(d) {
  return String(d || '—');
}

function pickPhotoRowsOldestAndNewest_(rowsSortedAsc, maxTake) {
  maxTake = Math.max(1, maxTake || 1);
  if (!rowsSortedAsc || !rowsSortedAsc.length) return [];
  if (rowsSortedAsc.length <= maxTake) return rowsSortedAsc.slice();
  var head = Math.ceil(maxTake / 2);
  var tail = maxTake - head;
  var a = rowsSortedAsc.slice(0, head);
  var b = rowsSortedAsc.slice(-tail);
  var merged = a.concat(b);
  var seen = {};
  var out = [];
  for (var i = 0; i < merged.length; i++) {
    var k = merged[i].fid;
    if (seen[k]) continue;
    seen[k] = 1;
    out.push(merged[i]);
  }
  return out;
}

function collectLabeledPhotosForInspectionHits_(hits, maxPerAudit, maxTotal) {
  maxPerAudit = maxPerAudit || 4;
  maxTotal = maxTotal || 16;
  if (!hits || !hits.length) return [];
  var out = [];
  var nInsp = hits.length;
  for (var hi = 0; hi < hits.length && out.length < maxTotal; hi++) {
    var aid = String(hits[hi].id || '').trim();
    if (!aid) continue;
    var room = maxTotal - out.length;
    var per = Math.min(maxPerAudit, room);
    if (per < 1) break;
    var photoRes = ecApiGet_('/api/v1/equipcare/audits/' + encodeURIComponent(aid) + '/photos');
    var photos = (photoRes && photoRes.photos) || [];
    var rows = [];
    for (var r = 0; r < photos.length; r++) {
      var fid = String(photos[r].driveFileId || '').trim();
      if (!fid) continue;
      var upT = new Date(String(photos[r].uploadedAt || '')).getTime();
      if (isNaN(upT)) upT = r;
      rows.push({ fid: fid, upT: upT, r: r });
    }
    rows.sort(function (a, b) {
      if (a.upT !== b.upT) return a.upT - b.upT;
      return a.r - b.r;
    });
    var picked = pickPhotoRowsOldestAndNewest_(rows, per);
    for (var p = 0; p < picked.length; p++) {
      try {
        var file = DriveApp.getFileById(picked[p].fid);
        var blob = file.getBlob();
        var bytes = blob.getBytes();
        if (bytes.length > 4 * 1024 * 1024) continue;
        var mt = String(blob.getContentType() || 'image/jpeg');
        if (mt.indexOf('image/') !== 0) continue;
        var inspLabel = hi + 1;
        var imgId = 'IMG-I' + inspLabel + '-P' + (p + 1);
        var cap =
          '[' +
          imgId +
          '] Inspection visit ' +
          inspLabel +
          ' of ' +
          nInsp +
          ' (1 = most recent calendar visit). Date: ' +
          formatAuditDateForCaption_(hits[hi].date) +
          '. Photo ' +
          (p + 1) +
          ' of ' +
          picked.length +
          ' for this visit.';
        out.push({ mime: mt, b64: Utilities.base64Encode(bytes), caption: cap });
      } catch (e) {
        continue;
      }
    }
  }
  return out;
}

function appendAiReviewRow_(assetNumber, triggerAuditId, model, summaryText) {
  ecApiPost_('/api/v1/equipcare/ai-reviews', {
    assetNumber: assetNumber,
    triggerAuditId: triggerAuditId,
    model: model,
    summaryText: String(summaryText || '').substring(0, 30000)
  });
}

function callOpenAiMultimodal_(apiKey, userContent, modelName) {
  modelName = modelName || getOpenAiVisionModel_();
  var body = {
    model: modelName,
    max_tokens: 4096,
    messages: [{ role: 'user', content: userContent }]
  };
  var res = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var txt = res.getContentText();
  if (code !== 200) throw new Error('OpenAI error ' + code + ': ' + txt.substring(0, 400));
  var json = JSON.parse(txt);
  var out =
    json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content
      ? String(json.choices[0].message.content).trim()
      : '';
  return out;
}

function runInspectionAiAnalysisInternal_(assetNumber, triggerAuditId) {
  assetNumber = String(assetNumber || '').trim();
  triggerAuditId = String(triggerAuditId || '').trim();
  if (!assetNumber || !triggerAuditId) {
    return { ok: false, error: 'Missing asset or inspection id.' };
  }
  var key = getOpenAiApiKey_();
  if (!key) {
    return {
      ok: true,
      skipped: true,
      message: 'AI review is not configured. Add script property EC_OPENAI_API_KEY (OpenAI API key).'
    };
  }
  var hits = collectRecentCompletedAuditsForAsset_(assetNumber, 5);
  if (!hits.length) {
    return { ok: true, skipped: true, message: 'No completed inspections to analyze.' };
  }
  var textBlock = '';
  for (var i = 0; i < hits.length; i++) {
    textBlock += '--- Inspection ' + (i + 1) + ' (newest visit first; compare to older visits below) ---\n';
    textBlock += auditObjToTextBlock_(hits[i].audit) + '\n\n';
  }
  var labeled = collectLabeledPhotosForInspectionHits_(hits, 4, 16);
  var visionModel = getOpenAiVisionModel_();
  var prompt =
    'You are a senior equipment inspection analyst. You have TEXT for up to five visits (inspection visit 1 = most recent calendar date) plus IMAGES tagged like [IMG-I1-P1].\n\n' +
    'Rules:\n' +
    '- Treat TEXT grades (Pass/Fail) as hints only. If ANY image shows cracks, breaks, missing pieces, deformation, corrosion, leaks, or worse condition than another image of the same object/area, you MUST say so even when text says Pass.\n' +
    '- Act like a careful human comparing photos side-by-side: note lighting differences but still compare shape, continuity, and visible damage.\n' +
    '- Within one visit, early vs late photos may show progression; across visits, lower inspection numbers are MORE RECENT (I1 newer than I2).\n\n' +
    'Required output structure (use these markdown headings in order):\n' +
    '### Visual comparison across time\n' +
    '- Write at least FOUR bullets. Each bullet MUST cite two image IDs (e.g. [IMG-I3-P1] vs [IMG-I1-P2]) and state what changed: worse damage, repaired/improved, same angle no visible change, or cannot compare because subjects differ.\n' +
    '- If only one visit has photos, compare two photos from that visit (early vs late upload).\n' +
    '### What each image shows\n' +
    '- One short line per [IMG-*] you received: subject + visible condition.\n' +
    '### Safety and operations (from text + photos)\n' +
    '### Damage and deterioration (from text + photos; override Pass if images disagree)\n' +
    '### Inconsistencies (grades vs images, visit vs visit)\n\n' +
    'Inspection TEXT data:\n' +
    textBlock;
  var content = [{ type: 'text', text: prompt }];
  for (var j = 0; j < labeled.length; j++) {
    var item = labeled[j];
    content.push({ type: 'text', text: item.caption });
    var detail = j < 8 ? 'high' : 'auto';
    content.push({
      type: 'image_url',
      image_url: { url: 'data:' + item.mime + ';base64,' + item.b64, detail: detail }
    });
  }
  var summary = callOpenAiMultimodal_(key, content, visionModel);
  appendAiReviewRow_(assetNumber, triggerAuditId, visionModel, summary);
  return { ok: true, summary: summary };
}

function maybeEnsureAiReviewForReport_(auditId, assetNumber) {
  auditId = String(auditId || '').trim();
  assetNumber = String(assetNumber || '').trim();
  if (!auditId || !assetNumber) return null;
  if (getAiReviewsForTriggerAuditId_(auditId).length) return null;
  if (!getOpenAiApiKey_()) {
    return '[NO_KEY]';
  }
  try {
    var res = runInspectionAiAnalysisInternal_(assetNumber, auditId);
    if (res && res.ok && res.skipped && res.message) return res.message;
    if (res && !res.ok && res.error) return res.error;
    if (getAiReviewsForTriggerAuditId_(auditId).length) return null;
    return 'AI finished but no review row was found for this inspection in the database.';
  } catch (e) {
    return e.message || String(e);
  }
}

function apiRunInspectionAiAnalysis(payload) {
  try {
    requireRegisteredUser_();
    var p = payload || {};
    return runInspectionAiAnalysisInternal_(p.assetNumber, p.triggerAuditId);
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}
