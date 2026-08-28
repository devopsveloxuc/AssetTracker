/**
 * EquipCare AI — data via VeloxInternal-API (Render Postgres).
 *
 * Required Script Properties:
 *   EC_API_URL              e.g. https://veloxinternal-api.onrender.com
 *   EC_API_SERVICE_KEY      same TRACKER_API_SERVICE_KEY as Project Tracker
 * Optional fallbacks: TRACKER_API_URL, TRACKER_API_SERVICE_KEY
 *
 * Photos still use Google Drive; metadata is stored in Postgres via the API.
 * EC_SPREADSHEET_ID is only used for one-time Sheets → API import (9_SheetsImport.gs).
 *
 * For AI review: EC_OPENAI_API_KEY (optional). Optional EC_OPENAI_VISION_MODEL.
 */
var EC_SPREADSHEET_ID = '1BNNc48SyYF8eriNHW9aDBy05fE57dqay';

function getEquipCareSpreadsheetId_() {
  var p = PropertiesService.getScriptProperties().getProperty('EC_SPREADSHEET_ID');
  if (p != null && String(p).trim() !== '') return String(p).trim();
  var id = String(EC_SPREADSHEET_ID || '').trim();
  if (!id) {
    throw new Error(
      'Set EC_SPREADSHEET_ID in 0_Config.gs or Script property EC_SPREADSHEET_ID (import only).'
    );
  }
  return id;
}

/** Legacy sheet names — used only by import helpers. */
var SH_LOCATIONS = 'EC_Locations';
var SH_ASSETS = 'EC_Assets';
var SH_USERS = 'EC_Users';
var SH_AUDITS = 'EC_Audits';
var SH_AUDIT_PHOTOS = 'EC_AuditPhotos';
var SH_EQUIPMENT_TYPES = 'EC_EquipmentTypes';
var SH_AI_REVIEWS = 'EC_AiInspectionReviews';
var SH_MAINTENANCE = 'EC_Maintenance';
var SH_ISSUES = 'EC_Issues';
var SH_USAGE_FORMS = 'EC_UsageForms';
var SH_USAGE_KIT_ITEMS = 'EC_UsageKitItems';

function getOpenAiApiKey_() {
  var p = PropertiesService.getScriptProperties();
  return String(p.getProperty('EC_OPENAI_API_KEY') || p.getProperty('OPENAI_API_KEY') || '').trim();
}

function getOpenAiVisionModel_() {
  var m = String(PropertiesService.getScriptProperties().getProperty('EC_OPENAI_VISION_MODEL') || '').trim();
  return m || 'gpt-4o';
}

var ROLE_ADMIN = 'Admin';
var ROLE_MANAGER = 'Manager';
var ROLE_FIELD = 'Field';

var USER_TYPE_INTERNAL = 'Internal';
var USER_TYPE_EXTERNAL = 'External';

var AUDIT_TYPE_INTERNAL = 'Internal';
var AUDIT_TYPE_ISSUE = 'Issue';
var AUDIT_TYPE_WEEKLY = 'Weekly';
var AUDIT_TYPE_RETURN = 'Return';
var AUDIT_TYPE_SPOT = 'OwnerSpotCheck';

var USAGE_STATUS_DRAFT = 'Draft';
var USAGE_STATUS_ACTIVE = 'Active';
var USAGE_STATUS_RETURNED = 'Returned';
var USAGE_STATUS_CLOSED = 'Closed';
