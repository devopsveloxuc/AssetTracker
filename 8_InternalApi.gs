/**
 * HTTP client for VeloxInternal-API (Render) — EquipCare data plane.
 * Requires Script Properties: EC_API_URL + EC_API_SERVICE_KEY
 * (falls back to TRACKER_API_URL / TRACKER_API_SERVICE_KEY if set).
 *
 * EC_API_SERVICE_KEY must be the exact same value as Render env TRACKER_API_SERVICE_KEY
 * (same as Project Tracker Script Property TRACKER_API_SERVICE_KEY). Do not use TRACKER_API_SECRET.
 */

function ecProp_(name, fallback) {
  var v = PropertiesService.getScriptProperties().getProperty(name);
  if (v != null && String(v).trim() !== '') return String(v).trim();
  return fallback != null ? String(fallback) : '';
}

/** Strip surrounding quotes — matches API normalizeSecret. */
function ecNormalizeSecret_(value) {
  var s = String(value || '').trim();
  if (
    s.length >= 2 &&
    ((s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') ||
      (s.charAt(0) === "'" && s.charAt(s.length - 1) === "'"))
  ) {
    s = s.substring(1, s.length - 1).trim();
  }
  return s;
}

function getEcApiBaseUrl_() {
  var u = ecProp_('EC_API_URL', '') || ecProp_('TRACKER_API_URL', '');
  u = String(u || '').trim().replace(/\/+$/, '');
  return u;
}

function getEcApiServiceKey_() {
  return (
    ecNormalizeSecret_(ecProp_('EC_API_SERVICE_KEY', '')) ||
    ecNormalizeSecret_(ecProp_('TRACKER_API_SERVICE_KEY', ''))
  );
}

function useEcInternalApi_() {
  return !!(getEcApiBaseUrl_() && getEcApiServiceKey_());
}

function requireEcApiConfigured_() {
  if (!useEcInternalApi_()) {
    throw new Error(
      'Set Script Properties EC_API_URL and EC_API_SERVICE_KEY ' +
        '(or TRACKER_API_URL / TRACKER_API_SERVICE_KEY) to your VeloxInternal-API on Render. ' +
        'EC_API_SERVICE_KEY must match Render TRACKER_API_SERVICE_KEY (not TRACKER_API_SECRET).'
    );
  }
}

function ecServiceKeyFingerprint_(key) {
  key = String(key || '');
  if (!key) return '(empty)';
  if (key.length <= 6) return 'len=' + key.length + ' (too short — check value)';
  return (
    'len=' +
    key.length +
    ' prefix=' +
    key.substring(0, 2) +
    '…' +
    ' suffix=…' +
    key.substring(key.length - 2)
  );
}

function isTransientEcApiError_(msg) {
  msg = String(msg || '').toLowerCase();
  return (
    msg.indexOf('address unavailable') >= 0 ||
    msg.indexOf('timeout') >= 0 ||
    msg.indexOf('timed out') >= 0 ||
    msg.indexOf('502') >= 0 ||
    msg.indexOf('503') >= 0 ||
    msg.indexOf('504') >= 0 ||
    msg.indexOf('bad gateway') >= 0 ||
    msg.indexOf('service unavailable') >= 0 ||
    msg.indexOf('econnreset') >= 0 ||
    msg.indexOf('socket hang up') >= 0 ||
    msg.indexOf('failed to fetch') >= 0
  );
}

/**
 * @param {string} method
 * @param {string} path e.g. /api/v1/equipcare/assets
 * @param {Object=} body
 * @param {Object=} opts
 * @returns {Object} parsed JSON (expects ok:true)
 */
function ecInternalApiRequest_(method, path, body, opts) {
  opts = opts || {};
  requireEcApiConfigured_();
  var base = getEcApiBaseUrl_();
  var headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-Tracker-Service-Key': getEcApiServiceKey_()
  };
  var actor = '';
  try {
    actor = Session.getActiveUser().getEmail() || '';
  } catch (e) {}
  if (actor) headers['X-User-Email'] = String(actor).trim().toLowerCase();
  if (opts.userEmail) headers['X-User-Email'] = String(opts.userEmail).trim().toLowerCase();

  var url = base + path;
  var maxAttempts = parseInt(ecProp_('EC_API_RETRIES', '4'), 10);
  if (!isFinite(maxAttempts) || maxAttempts < 1) maxAttempts = 4;
  if (maxAttempts > 8) maxAttempts = 8;
  if (opts.noRetry) maxAttempts = 1;

  var attempt;
  var lastErr;
  for (attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      var options = {
        method: method,
        headers: headers,
        muteHttpExceptions: true,
        contentType: 'application/json'
      };
      if (body != null) options.payload = JSON.stringify(body);
      var resp = UrlFetchApp.fetch(url, options);
      var code = resp.getResponseCode();
      var text = resp.getContentText() || '';
      var parsed;
      try {
        parsed = JSON.parse(text || '{}');
      } catch (e) {
        var snippet = String(text).substring(0, 160).replace(/\s+/g, ' ').trim();
        throw new Error('API HTTP ' + code + (snippet ? ': ' + snippet : ' (non-JSON response)'));
      }
      if (code < 200 || code >= 300 || parsed.ok === false) {
        var apiErr = parsed.error || 'API error ' + code;
        if (isTransientEcApiError_(apiErr) && attempt < maxAttempts) {
          Utilities.sleep(Math.min(20000, 1500 * attempt * attempt));
          continue;
        }
        throw new Error(apiErr);
      }
      return parsed;
    } catch (e) {
      lastErr = e;
      var msg = e && e.message ? e.message : String(e);
      if (isTransientEcApiError_(msg) && attempt < maxAttempts) {
        Utilities.sleep(Math.min(20000, 1500 * attempt * attempt));
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error('API request failed');
}

function ecApiGet_(path) {
  return ecInternalApiRequest_('get', path, null);
}

function ecApiPost_(path, body) {
  return ecInternalApiRequest_('post', path, body || {});
}

function ecApiPut_(path, body) {
  return ecInternalApiRequest_('put', path, body || {});
}

function ecApiPatch_(path, body) {
  return ecInternalApiRequest_('patch', path, body || {});
}

function ecApiDelete_(path) {
  return ecInternalApiRequest_('delete', path, null);
}

function ecBuildQuery_(params) {
  params = params || {};
  var parts = [];
  for (var k in params) {
    if (!Object.prototype.hasOwnProperty.call(params, k)) continue;
    var v = params[k];
    if (v == null || v === '') continue;
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
  }
  return parts.length ? '?' + parts.join('&') : '';
}

/** Run from Apps Script editor after deploy to create equipcare schema/tables. */
function migrateEquipCareApi() {
  return ecApiPost_('/api/v1/equipcare/migrate', {});
}

function pingEquipCareApi() {
  return ecApiGet_('/api/v1/equipcare/ping');
}

/**
 * Run from the Apps Script editor to verify Script Properties + API auth.
 * Does not print the raw service key.
 * @returns {Object}
 */
function diagnoseEquipCareApiAuth() {
  var url = getEcApiBaseUrl_();
  var key = getEcApiServiceKey_();
  var keySource = ecProp_('EC_API_SERVICE_KEY', '')
    ? 'EC_API_SERVICE_KEY'
    : ecProp_('TRACKER_API_SERVICE_KEY', '')
      ? 'TRACKER_API_SERVICE_KEY'
      : '(none)';
  var out = {
    ok: false,
    apiUrl: url || '(missing)',
    keySource: keySource,
    serviceKeyFingerprint: ecServiceKeyFingerprint_(key),
    hasEcApiUrl: !!ecProp_('EC_API_URL', ''),
    hasTrackerApiUrl: !!ecProp_('TRACKER_API_URL', ''),
    hasEcApiServiceKey: !!ecProp_('EC_API_SERVICE_KEY', ''),
    hasTrackerApiServiceKey: !!ecProp_('TRACKER_API_SERVICE_KEY', ''),
    hint:
      'Copy TRACKER_API_SERVICE_KEY from Project Tracker Script Properties (or Render env) into EquipCare EC_API_SERVICE_KEY. Do not use TRACKER_API_SECRET.'
  };
  if (!url || !key) {
    out.error = 'EC_API_URL and EC_API_SERVICE_KEY (or TRACKER_* fallbacks) must both be set.';
    return out;
  }
  try {
    var ping = pingEquipCareApi();
    out.ok = !!(ping && ping.ok);
    out.ping = ping;
  } catch (e) {
    out.error = e && e.message ? e.message : String(e);
    if (/invalid service key/i.test(out.error)) {
      out.hint =
        'Key is sent but does not match Render TRACKER_API_SERVICE_KEY. ' +
        'Open Project Tracker → Project Settings → Script properties, copy TRACKER_API_SERVICE_KEY exactly into EquipCare EC_API_SERVICE_KEY (no quotes). ' +
        'Fingerprint now: ' +
        out.serviceKeyFingerprint;
    } else if (/missing service key|not configured/i.test(out.error)) {
      out.hint =
        'API rejected auth. Confirm EC_API_SERVICE_KEY is set and Render has TRACKER_API_SERVICE_KEY.';
    }
  }
  return out;
}
