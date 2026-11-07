/**
 * CallFlow CRM — Google Sheet → CRM lead sync (NOT DEPLOYED; see README.md).
 *
 * - syncLeads() runs on a 1-minute time-driven trigger (no onEdit/onFormSubmit:
 *   those miss rows written by the Meta integration and can't hold a lock).
 * - LockService stops two runs overlapping; a run exits in milliseconds when
 *   getLastRow() hasn't moved past the last synced row (stored in PropertiesService).
 * - Unsynced rows go to POST /api/v1/crm/leads/ingest in ONE batch; each row's
 *   result ("synced <time>" or the error) is written into the "CRM Sync" column.
 * - After every successful run it pings Healthchecks.io, so a silent stop alerts.
 * - Error emails are de-duplicated: at most one per distinct error per hour.
 * - reconcileYesterday() runs nightly at 00:15 and checks the previous day's row
 *   IDs against the server, re-sends anything missing and emails the result.
 *
 * Script properties (Project settings → Script properties):
 *   CRM_SECRET      same value as CRM_INGEST_SECRET on the server (32+ chars)
 */
var CONFIG = {
  API_BASE: 'https://callflow.maxmusicschool.co.in/api/v1/crm',   // placeholder until go-live
  SHEET_NAME: 'Lead',
  HEALTHCHECK_URL: 'https://hc-ping.com/REPLACE-WITH-CHECK-UUID',  // placeholder
  ALERT_EMAIL: 'owner@example.com',                                // placeholder
  BATCH_MAX: 500,                                                  // server limit per request
  SYNC_COLUMN: 'CRM Sync',
  // Sheet header → intake field (the client's "Lead" tab). It has no id column, so the row ID is
  // built from Timestamp + Contact (see rowId_); a header that isn't found is sent empty.
  // '#F' means column F by position: the rep column has no header.
  COLUMNS: { external_id: 'id', created_at: 'Timestamp', name: 'Name', phone: 'Contact',
             email: 'Email', campaign: 'Campaign', source: 'Source',
             status: 'Status', rep: '#F', amount: 'Amount', guitar: 'Guitar' },
};

/** Run once by hand: installs both triggers (and removes old copies). */
function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncLeads').timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger('reconcileYesterday').timeBased().atHour(0).nearMinute(15).everyDays(1)
    .inTimezone('Asia/Kolkata').create();
}

function syncLeads() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;               // previous run still going
  try {
    var props = PropertiesService.getScriptProperties();
    var sheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.SHEET_NAME);
    var last = sheet.getLastRow();
    var synced = Number(props.getProperty('LAST_SYNCED_ROW') || 1); // row 1 = header
    if (last <= synced) { ping_(); return; }     // fast exit: nothing new

    var end = Math.min(last, synced + CONFIG.BATCH_MAX);
    var h = headers_(sheet);
    var rows = sheet.getRange(synced + 1, 1, end - synced, h.width).getValues();
    var results = post_('/leads/ingest', rows.map(function (r) { return toLead_(r, h); }));

    var stamp = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd MMM HH:mm');
    var out = results.map(function (r) {
      return [r.result === 'error' || r.result === 'invalid'
        ? 'error: ' + (r.error || r.result)
        : 'synced ' + stamp + ' (' + r.result + (r.lead_code ? ' ' + r.lead_code : '') + ')'];
    });
    sheet.getRange(synced + 1, h.sync, out.length, 1).setValues(out);
    props.setProperty('LAST_SYNCED_ROW', String(end));
    ping_();
  } catch (e) {
    notify_('Lead sync failed', e);
  } finally {
    lock.releaseLock();
  }
}

/** Nightly: every row of yesterday (IST) the server doesn't have is re-sent; the result is emailed. */
function reconcileYesterday() {
  var lock = LockService.getScriptLock();
  if (!lock.waitLock(60000)) return;
  try {
    var sheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.SHEET_NAME);
    var h = headers_(sheet);
    var day = Utilities.formatDate(new Date(Date.now() - 864e5), 'Asia/Kolkata', 'yyyy-MM-dd');
    var all = sheet.getRange(2, 1, Math.max(0, sheet.getLastRow() - 1), h.width).getValues();
    var mine = all.map(function (r, i) { return { row: i + 2, values: r }; }).filter(function (x) {
      var t = when_(x.values[h.cols.created_at]);
      return t && Utilities.formatDate(t, 'Asia/Kolkata', 'yyyy-MM-dd') === day && rowId_(x.values, h);
    });
    var ids = mine.map(function (x) { return rowId_(x.values, h); });
    var missing = ids.length ? post_('/leads/reconcile', { external_ids: ids }).missing : [];
    var resent = [];
    if (missing.length) {
      var redo = mine.filter(function (x) { return missing.indexOf(rowId_(x.values, h)) >= 0; });
      resent = post_('/leads/ingest', redo.map(function (x) { return toLead_(x.values, h); }));
    }
    MailApp.sendEmail(CONFIG.ALERT_EMAIL, 'CRM lead reconcile ' + day + ': ' + missing.length + ' missing',
      ids.length + ' sheet rows checked, ' + missing.length + ' missing on the server.' +
      (missing.length ? '\nRe-sent: ' + resent.map(function (r) { return r.external_id + ' → ' + r.result; }).join(', ') : ''));
  } catch (e) {
    notify_('Lead reconcile failed', e);
  } finally {
    lock.releaseLock();
  }
}

// ── helpers ──────────────────────────────────────────────────────────────

function headers_(sheet) {
  var names = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  var sync = names.indexOf(CONFIG.SYNC_COLUMN);
  if (sync < 0) { sync = names.length; sheet.getRange(1, sync + 1).setValue(CONFIG.SYNC_COLUMN); }
  var cols = {};
  Object.keys(CONFIG.COLUMNS).forEach(function (k) {
    var n = CONFIG.COLUMNS[k];
    cols[k] = /^#[A-Z]$/.test(n) ? n.charCodeAt(1) - 65 : names.indexOf(n);
  });
  if (cols.phone < 0) throw new Error('Column "' + CONFIG.COLUMNS.phone + '" not found');
  return { cols: cols, sync: sync + 1, width: Math.max(names.length, sync + 1) };
}

function cell_(r, h, k) { return h.cols[k] >= 0 ? r[h.cols[k]] : ''; }

/** A Date cell, or text "dd/MM/yyyy HH:mm:ss" read as IST (new Date() would read it as US month/day). */
function when_(t) {
  if (t instanceof Date) return t;
  var m = String(t || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  var p = function (x) { return ('0' + x).slice(-2); };
  return new Date(m[3] + '-' + p(m[2]) + '-' + p(m[1]) + 'T' + p(m[4]) + ':' + m[5] + ':' + (m[6] || '00') + '+05:30');
}

/** The sheet's id if it has one, else Timestamp + Contact: stable when rows are sorted or inserted. */
function rowId_(r, h) {
  var id = String(cell_(r, h, 'external_id') || '').trim();
  if (id) return id;
  var t = when_(cell_(r, h, 'created_at'));
  var digits = String(cell_(r, h, 'phone') || '').replace(/\D/g, '');
  return t && digits ? 'sheet-' + Utilities.formatDate(t, 'Asia/Kolkata', 'yyyyMMddHHmmss') + '-' + digits : '';
}

function toLead_(r, h) {
  var v = function (k) { return String(cell_(r, h, k) || '').trim(); };
  var t = when_(cell_(r, h, 'created_at'));
  return {
    external_id: rowId_(r, h), name: v('name'), phone: v('phone'), email: v('email'),
    campaign: v('campaign'), source: v('source') || 'meta', created_at: t ? t.toISOString() : '',
    status: v('status'), rep: v('rep'), amount: v('amount'), guitar: v('guitar'),
  };
}

function post_(path, body) {
  var secret = PropertiesService.getScriptProperties().getProperty('CRM_SECRET');
  if (!secret) throw new Error('Script property CRM_SECRET is not set');
  var res = UrlFetchApp.fetch(CONFIG.API_BASE + path, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(body),
    headers: { 'X-CRM-Secret': secret }, muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  if (code !== 200) throw new Error('HTTP ' + code + ' from ' + path + ': ' + res.getContentText().slice(0, 200));
  var json = JSON.parse(res.getContentText());
  return json.results || json;
}

function ping_() {
  try { UrlFetchApp.fetch(CONFIG.HEALTHCHECK_URL, { muteHttpExceptions: true }); } catch (e) { /* the ping is best-effort */ }
}

/** Email an error at most once per hour per distinct message. */
function notify_(subject, e) {
  var msg = String(e && e.message || e);
  var key = 'ERR_' + Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, msg)).slice(0, 16);
  var props = PropertiesService.getScriptProperties();
  var lastSent = Number(props.getProperty(key) || 0);
  if (Date.now() - lastSent < 3600e3) return;
  props.setProperty(key, String(Date.now()));
  MailApp.sendEmail(CONFIG.ALERT_EMAIL, 'CallFlow CRM: ' + subject, msg + '\n\n' + (e && e.stack || ''));
}
