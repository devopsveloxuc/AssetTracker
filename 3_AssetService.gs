function listAssets_() {
  var res = ecApiGet_('/api/v1/equipcare/assets');
  return (res && res.assets) || [];
}

function saveAsset_(payload) {
  var p = payload || {};
  var num = String(p.assetNumber || '').trim();
  if (!num) throw new Error('Asset Number is required.');
  if (!String(p.description || '').trim()) throw new Error('Description is required.');
  var body = {
    assetNumber: num,
    description: String(p.description || '').trim(),
    capitalToolNumber: String(p.capitalToolNumber || '').trim(),
    category: String(p.category || p.assetType || '').trim(),
    subCategory: String(p.subCategory || '').trim(),
    status: String(p.status || '').trim(),
    assetType: String(p.assetType || p.category || '').trim(),
    make: String(p.make || '').trim(),
    model: String(p.model || '').trim(),
    year: p.year == null || p.year === '' ? '' : p.year,
    vinSerial: String(p.vinSerial || '').trim(),
    plateNumber: String(p.plateNumber || '').trim(),
    licensed: String(p.licensed || '').trim(),
    maxPmIntervalDays: String(p.maxPmIntervalDays || '').trim(),
    maxPmHoursMileage: String(p.maxPmHoursMileage || '').trim(),
    notes: String(p.notes || '').trim(),
    active: p.active !== false && p.active !== 'No' && p.active !== 'no'
  };
  if (!body.status) body.status = body.active ? 'Active' : 'Retired';
  if (p.assetId != null && p.assetId !== '') body.assetId = p.assetId;
  var res = ecApiPost_('/api/v1/equipcare/assets', body);
  return {
    assetNumber: (res && res.assetNumber) || num,
    assetId: res && res.assetId != null ? res.assetId : null
  };
}

function deleteAsset_(payload) {
  var p = payload || {};
  var assetId = p.assetId != null && p.assetId !== '' ? Number(p.assetId) : NaN;
  var num = String(p.assetNumber || '').trim();
  if (Number.isFinite(assetId) && assetId > 0) {
    return ecApiDelete_('/api/v1/equipcare/assets/by-id/' + encodeURIComponent(String(assetId)));
  }
  if (!num) throw new Error('Asset Number or AssetID is required to delete.');
  return ecApiDelete_('/api/v1/equipcare/assets/' + encodeURIComponent(num));
}

function getAssetDetail_(assetId) {
  assetId = Number(assetId);
  if (!Number.isFinite(assetId) || assetId <= 0) throw new Error('AssetID is required.');
  var res = ecApiGet_(
    '/api/v1/equipcare/assets/by-id/' + encodeURIComponent(String(assetId)) + '/detail'
  );
  return (res && res.detail) || null;
}

function listAssignmentHistory_(assetId) {
  assetId = Number(assetId);
  if (!Number.isFinite(assetId) || assetId <= 0) throw new Error('AssetID is required.');
  var res = ecApiGet_(
    '/api/v1/equipcare/assets/by-id/' +
      encodeURIComponent(String(assetId)) +
      '/assignment-history'
  );
  return (res && res.history) || [];
}

function listActiveEmployees_() {
  var res = ecApiGet_('/api/v1/equipcare/active-employees');
  return (res && res.employees) || [];
}

function replaceAssignment_(payload) {
  var p = payload || {};
  var assetId = Number(p.assetId);
  if (!Number.isFinite(assetId) || assetId <= 0) throw new Error('AssetID is required.');
  var body = {
    employee: String(p.employee || '').trim(),
    location: String(p.location || '').trim(),
    project: String(p.project || '').trim(),
    outsideOfProjectArea: String(p.outsideOfProjectArea || '').trim()
  };
  if (p.assignedDate) body.assignedDate = String(p.assignedDate).trim();
  if (p.endPriorOn) body.endPriorOn = String(p.endPriorOn).trim();
  if (p.assignedId) body.assignedId = String(p.assignedId).trim();
  return ecApiPut_(
    '/api/v1/equipcare/assets/by-id/' + encodeURIComponent(String(assetId)) + '/assignment',
    body
  );
}
