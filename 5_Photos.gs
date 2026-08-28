/** Max decoded image size per upload (bytes). */
var EC_PHOTO_MAX_BYTES = 8 * 1024 * 1024;

function getAuditPhotoFolder_() {
  var props = PropertiesService.getScriptProperties();
  var fid = props.getProperty('EC_AUDIT_PHOTO_FOLDER_ID');
  if (fid) {
    try {
      return DriveApp.getFolderById(fid);
    } catch (e) {
      props.deleteProperty('EC_AUDIT_PHOTO_FOLDER_ID');
    }
  }
  var root = DriveApp.getRootFolder();
  var it = root.getFoldersByName('EquipCare Audit Photos');
  var folder = it.hasNext() ? it.next() : root.createFolder('EquipCare Audit Photos');
  props.setProperty('EC_AUDIT_PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

function parseUploadBase64_(p) {
  var raw = String((p && p.dataUrl) || '');
  var mime = 'image/jpeg';
  var b64;
  var m = raw.match(/^data:([^;]+);base64,(.+)$/);
  if (m) {
    mime = String(m[1] || mime).split(';')[0].trim() || mime;
    b64 = m[2].replace(/\s/g, '');
  } else if (p && p.base64) {
    b64 = String(p.base64).replace(/\s/g, '');
    mime = String(p.mimeType || 'image/jpeg').split(';')[0].trim();
  } else {
    throw new Error('Missing image data.');
  }
  if (!b64) throw new Error('Empty image data.');
  var bytes = Utilities.base64Decode(b64);
  if (!bytes || bytes.length === 0) throw new Error('Could not read image.');
  if (bytes.length > EC_PHOTO_MAX_BYTES) {
    throw new Error('Photo too large (max 8 MB per file).');
  }
  if (mime.indexOf('image/') !== 0) {
    throw new Error('Only image uploads are allowed.');
  }
  return { bytes: bytes, mime: mime };
}

function extensionForMime_(mime) {
  mime = String(mime || '').toLowerCase();
  if (mime.indexOf('png') !== -1) return '.png';
  if (mime.indexOf('webp') !== -1) return '.webp';
  if (mime.indexOf('gif') !== -1) return '.gif';
  return '.jpg';
}

function apiUploadAuditPhoto(payload) {
  try {
    requireRegisteredUser_();
    var p = payload || {};
    var auditId = String(p.auditId || '').trim();
    var assetNumber = String(p.assetNumber || '')
      .trim()
      .toLowerCase();
    if (!assetNumber) throw new Error('Missing asset.');
    if (!auditId) {
      auditId = createDraftAuditForAsset_(String(p.assetNumber || '').trim());
    }

    var auditRes = ecApiGet_('/api/v1/equipcare/audits/' + encodeURIComponent(auditId));
    var audit = auditRes && auditRes.audit;
    if (!audit) throw new Error('Inspection record not found.');
    if (String(audit.assetNumber || '').trim().toLowerCase() !== assetNumber) {
      throw new Error('This inspection does not belong to the selected asset.');
    }

    var eqType = String(p.equipmentType || '').trim();
    if (!eqType) throw new Error('Select an equipment type before uploading photos.');

    var parsed = parseUploadBase64_(p);
    var ext = extensionForMime_(parsed.mime);
    var fname =
      'EC-Audit-' +
      auditId.substring(0, 8) +
      '-' +
      new Date().getTime() +
      '-' +
      Math.floor(Math.random() * 10000) +
      ext;
    var blob = Utilities.newBlob(parsed.bytes, parsed.mime, fname);
    var folder = getAuditPhotoFolder_();
    var file = folder.createFile(blob);
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (shareErr) {}
    var id = file.getId();
    var viewUrl = 'https://drive.google.com/uc?export=view&id=' + id;
    var pid = Utilities.getUuid();

    var metaRes = ecApiPost_('/api/v1/equipcare/audits/' + encodeURIComponent(auditId) + '/photos', {
      photoId: pid,
      assetNumber: String(p.assetNumber || '').trim(),
      equipmentType: eqType,
      driveFileId: id,
      url: viewUrl,
      metaDateTime: String(p.metaDateTime || ''),
      metaLat: String(p.metaLat || ''),
      metaLng: String(p.metaLng || '')
    });

    return {
      ok: true,
      photoId: (metaRes && metaRes.photoId) || pid,
      url: viewUrl,
      driveFileId: id,
      auditId: auditId
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function apiListAuditPhotos(auditId) {
  try {
    requireRegisteredUser_();
    auditId = String(auditId || '').trim();
    if (!auditId) return { ok: true, photos: [] };
    var res = ecApiGet_('/api/v1/equipcare/audits/' + encodeURIComponent(auditId) + '/photos');
    return { ok: true, photos: (res && res.photos) || [] };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}
