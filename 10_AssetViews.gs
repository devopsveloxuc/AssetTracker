/**
 * Asset Management grid saved views (Postgres via VeloxInternal-API).
 * After API deploy, run migrateEquipCareApi() once (creates asset_views table + Standard view).
 */

function listAssetViews_() {
  return ecApiGet_('/api/v1/equipcare/asset-views');
}

function saveAssetView_(name, config) {
  return ecApiPost_('/api/v1/equipcare/asset-views', {
    name: String(name || '').trim(),
    config: config || {}
  });
}

function deleteAssetView_(name) {
  return ecApiDelete_('/api/v1/equipcare/asset-views/' + encodeURIComponent(String(name || '').trim()));
}

function setDefaultAssetView_(viewName) {
  return ecApiPost_('/api/v1/equipcare/asset-views/default', {
    viewName: String(viewName || '').trim() || 'Standard'
  });
}

function apiListAssetViews() {
  try {
    requireRegisteredUser_();
    var res = listAssetViews_();
    return {
      ok: true,
      views: (res && res.views) || [],
      defaultViewName: (res && res.defaultViewName) || 'Standard'
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function apiSaveAssetView(payload) {
  try {
    requireRegisteredUser_();
    var p = payload || {};
    var res = saveAssetView_(p.name || p.viewName, p.config);
    return {
      ok: true,
      name: res && res.name,
      config: res && res.config
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function apiDeleteAssetView(payload) {
  try {
    requireRegisteredUser_();
    var p = payload || {};
    var name = p.name || p.viewName;
    var res = deleteAssetView_(name);
    return { ok: true, name: res && res.name };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function apiSetDefaultAssetView(payload) {
  try {
    requireRegisteredUser_();
    var p = payload || {};
    var res = setDefaultAssetView_(p.viewName || p.name || p.defaultViewName);
    return { ok: true, defaultViewName: res && res.defaultViewName };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}
