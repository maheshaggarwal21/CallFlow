/**
 * CallFlow CRM — Google Sheet → CRM lead sync. Install, test and checklist: README.md.
 *
 * Triggers (setup() creates exactly these three and never touches any other trigger):
 *   syncLeads           every minute   new rows below the pointer, then the retry list
 *   sweepUnsynced       every hour     rows above the pointer whose CRM Sync cell is blank
 *   reconcileYesterday  daily ~00:15   yesterday's rows vs the server; emails "OK n / n" or "MISMATCH"
 * No onEdit/onChange/onFormSubmit (they miss rows written by integrations and can't hold a lock),
 * and no run creates or deletes triggers: the pace is fixed. Run time is measured and reported
 * nightly instead (see track_).
 *
 * Script properties (Project Settings → Script properties):
 *   CRM_SECRET       required: same value as CRM_INGEST_SECRET on the server
 *   ALERT_EMAILS     comma-separated recipients; empty = the account that installed the script
 *   HC_SYNC_URL      Healthchecks.io ping URL for syncLeads and sweepUnsynced
 *   HC_NIGHTLY_URL   Healthchecks.io ping URL for reconcileYesterday
 *   API_BASE         optional override of CONFIG.API_BASE (test copy: tunnel URL + /api/v1/crm)
 *   TEST_MODE        "true" on a test copy: refuses to run against production
 * Kept by the script: LAST_SYNCED_ROW, RETRY, ALERT_*, RUN_MS_*, RUNS_*, SWEPT_*
 */
var CONFIG = {
  API_BASE: 'https://callflow.maxmusicschool.co.in/api/v1/crm',
  PROD_DOMAIN: 'callflow.maxmusicschool.co.in',
  SHEET_NAME: 'Lead',
  SYNC_COLUMN: 'CRM Sync',
  BATCH_MAX: 50,          // rows per request: ~7 DB round trips a row, must finish inside the 60 s fetch limit
  RUN_MS: 4 * 60 * 1000,  // stop starting new batches after 4 min (Apps Script stops a run at 6)
  MAX_TRIES: 5,           // a row the server answers "error" for is tried this many times in all
  RETRY_MAX_CHARS: 8000,  // Script Properties values max out around 9 KB
  ALERT_EVERY_MS: 3600e3, // at most one email per error type per hour
  RUNTIME_WARN_MIN: 45,   // half the ~90 min/day trigger quota of a free Gmail account
  // Sheet header → intake field (the client's "Lead" tab). It has no id column, so the row ID is
  // Timestamp + Contact (see rowId_); a header that isn't found is sent empty.
  // '#F' means column F by position: the rep column has no header.
  COLUMNS: { external_id: 'id', created_at: 'Timestamp', name: 'Name', phone: 'Contact',
             email: 'Email', campaign: 'Campaign', source: 'Source',
             status: 'Status', rep: '#F', amount: 'Amount', guitar: 'Guitar' },
};
var HANDLERS = ['syncLeads', 'sweepUnsynced', 'reconcileYesterday'];
var TZ = 'Asia/Kolkata';

/** Run once by hand. Re-runnable: replaces only this script's three triggers. */
function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (HANDLERS.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncLeads').timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger('sweepUnsynced').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('reconcileYesterday').timeBased().atHour(0).nearMinute(15).everyDays(1).inTimezone(TZ).create();
}

// ── every minute ────────────────────────────────────────────────────────────

function syncLeads() {
  var started = Date.now();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) { track_(started); return; }   // another run holds the lock: quiet exit
  try {
    guard_();
    var props = PropertiesService.getScriptProperties();
    var sheet = sheet_();
    // Fast exit before any network call
    if (sheet.getLastRow() <= pointer_(props) && !retryList_(props).length) { hc_('HC_SYNC_URL', false); return; }
    var ctx = { sheet: sheet, props: props, h: headers_(sheet) };
    retryQueued_(ctx);
    while (Date.now() - started < CONFIG.RUN_MS) {
      var last = sheet.getLastRow(), from = pointer_(props);
      if (last <= from) break;
      var end = Math.min(last, from + CONFIG.BATCH_MAX);
      var values = sheet.getRange(from + 1, 1, end - from, ctx.h.width).getValues();
      sendRows_(ctx, values.map(function (v, i) { return { row: from + 1 + i, values: v }; }));
      props.setProperty('LAST_SYNCED_ROW', String(end));   // only after the results are written and flushed
    }
    hc_('HC_SYNC_URL', false);
  } catch (e) {
    fail_('sync', 'Lead sync failed', e, 'HC_SYNC_URL');
  } finally {
    lock.releaseLock();
    track_(started);
  }
}

// ── every hour ──────────────────────────────────────────────────────────────

/** Rows above the pointer with a blank CRM Sync cell (moved by a sort, or inserted) get sent. */
function sweepUnsynced() {
  var started = Date.now();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) { track_(started); return; }
  try {
    guard_();
    var props = PropertiesService.getScriptProperties();
    var sheet = sheet_();
    var ctx = { sheet: sheet, props: props, h: headers_(sheet) };
    var upto = Math.min(sheet.getLastRow(), pointer_(props));   // rows past the pointer are syncLeads' job
    var blank = [];
    if (upto >= 2) {
      sheet.getRange(2, 1, upto - 1, ctx.h.width).getValues().forEach(function (v, i) {
        if (String(v[ctx.h.sync - 1]).trim() === '' && hasLead_(v, ctx.h)) blank.push({ row: i + 2, values: v });
      });
    }
    var sent = 0;
    for (var i = 0; i < blank.length && Date.now() - started < CONFIG.RUN_MS; i += CONFIG.BATCH_MAX) {
      var batch = blank.slice(i, i + CONFIG.BATCH_MAX);
      sendRows_(ctx, batch);
      sent += batch.length;
    }
    if (sent) add_(props, 'SWEPT_' + dayOf_(started), sent);
    hc_('HC_SYNC_URL', false);
  } catch (e) {
    fail_('sweep', 'Lead sweep failed', e, 'HC_SYNC_URL');
  } finally {
    lock.releaseLock();
    track_(started);
  }
}

// ── nightly ~00:15 IST ──────────────────────────────────────────────────────

/**
 * Yesterday's rows (by the lead's own Timestamp) vs the server: re-sends what is missing and emails
 * "OK n / n" or "MISMATCH n / m" every night, so a missing email is itself the alarm. Also reports
 * the sweep count and yesterday's trigger run time, then resets those counters.
 */
function reconcileYesterday() {
  var started = Date.now();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) {   // tryLock, not waitLock: waitLock throws instead of returning false
    fail_('nightly', 'Nightly check skipped', new Error('could not get the script lock within 60 s'), 'HC_NIGHTLY_URL');
    track_(started);
    return;
  }
  try {
    guard_();
    var props = PropertiesService.getScriptProperties();
    var sheet = sheet_();
    var ctx = { sheet: sheet, props: props, h: headers_(sheet) };
    var h = ctx.h;
    var day = dayOf_(started - 864e5);
    var last = sheet.getLastRow();
    var mine = last < 2 ? [] : sheet.getRange(2, 1, last - 1, h.width).getValues()
      .map(function (v, i) { return { row: i + 2, values: v }; })
      .filter(function (x) { var t = when_(cell_(x.values, h, 'created_at')); return t && dayOf_(t.getTime()) === day && rowId_(x.values, h); });
    var ids = mine.map(function (x) { return rowId_(x.values, h); });

    var missing = [];
    for (var i = 0; i < ids.length; i += 5000) missing = missing.concat(post_('/leads/reconcile', { external_ids: ids.slice(i, i + 5000) }).missing);
    var redo = mine.filter(function (x) { return missing.indexOf(rowId_(x.values, h)) >= 0; });
    for (var j = 0; j < redo.length; j += CONFIG.BATCH_MAX) sendRows_(ctx, redo.slice(j, j + CONFIG.BATCH_MAX));

    var runMs = Number(props.getProperty('RUN_MS_' + day) || 0), runs = Number(props.getProperty('RUNS_' + day) || 0);
    var swept = Number(props.getProperty('SWEPT_' + day) || 0), mins = runMs / 60000;
    var found = ids.length - missing.length;
    var subject = (missing.length ? 'MISMATCH ' : 'OK ') + found + ' / ' + ids.length + ' · CallFlow leads ' + day;
    var body = [
      'CallFlow lead sync, ' + day + ' (yesterday, IST)', '',
      'Rows in the sheet: ' + ids.length,
      'Leads in the CRM:  ' + found,
      'Missing:           ' + missing.length + (missing.length ? ' (' + missing.slice(0, 50).join(', ') + (missing.length > 50 ? ', …' : '') + ')' : ''),
      'Re-sent:           ' + (redo.length ? redo.map(function (x) { return x.row + ': ' + x.label; }).slice(0, 50).join('; ') : 'nothing to re-send'), '',
      'Hourly sweep:      ' + swept + ' row(s) without a CRM Sync result were sent',
      'Trigger run time:  ' + mins.toFixed(1) + ' min over ' + runs + ' runs',
      'Retry list:        ' + retryList_(props).length + ' row(s) waiting',
    ];
    if (mins > CONFIG.RUNTIME_WARN_MIN) {
      body.push('', 'WARNING: over ' + CONFIG.RUNTIME_WARN_MIN + ' min, half the ~90 min/day trigger quota of a free Gmail account. ' +
        'Consider changing the trigger to every 2 minutes (edit setup() and run it again).');
    }
    mail_(subject, body.join('\n'));
    // Counters reset once a day, after the report (also clears any older leftovers)
    props.getKeys().forEach(function (k) {
      var m = k.match(/^(RUN_MS|RUNS|SWEPT)_(\d{4}-\d{2}-\d{2})$/);
      if (m && m[2] <= day) props.deleteProperty(k);
    });
    hc_('HC_NIGHTLY_URL', false);
  } catch (e) {
    fail_('nightly', 'Nightly check failed', e, 'HC_NIGHTLY_URL');
  } finally {
    lock.releaseLock();
    track_(started);
  }
}

// ── sending, labels, retries ────────────────────────────────────────────────

/** POST the rows, write each row's result into CRM Sync (flushed), queue row errors for retry. */
function sendRows_(ctx, items) {
  if (!items.length) return;
  var results = postItems_(ctx, items);
  var stamp = Utilities.formatDate(new Date(), TZ, 'dd MMM HH:mm');
  var failed = [];
  items.forEach(function (x, i) {
    var r = results[i];
    x.label = label_(r, stamp);
    if (r.result === 'error') failed.push({ external_id: rowId_(x.values, ctx.h), row_hint: x.row, item: x });
  });
  queueRetries_(ctx, failed).forEach(function (f) { f.item.label += ' (retry list full)'; });
  writeLabels_(ctx, items);
}

/** Results in the same order as the rows; a missing result counts as an error. */
function postItems_(ctx, items) {
  var res = post_('/leads/ingest', items.map(function (x) { return toLead_(x.values, ctx.h); }));
  return items.map(function (x, i) { return res[i] || { result: 'error', error: 'no result from the server' }; });
}

function label_(r, stamp) {
  if (r.result === 'created') return 'synced ' + stamp + ' (' + r.lead_code + ')';
  if (r.result === 'duplicate') return 'duplicate';
  if (r.result === 'reenquired') return 're-enquiry (' + r.lead_code + ')';
  if (r.result === 'invalid') return 'invalid: ' + (r.error || 'rejected');
  return 'error: ' + (r.error || r.result || 'unknown');
}

function writeLabels_(ctx, items) {
  var col = ctx.h.sync;
  var contiguous = items.every(function (x, i) { return i === 0 || x.row === items[i - 1].row + 1; });
  if (contiguous) ctx.sheet.getRange(items[0].row, col, items.length, 1).setValues(items.map(function (x) { return [x.label]; }));
  else items.forEach(function (x) { ctx.sheet.getRange(x.row, col).setValue(x.label); });
  SpreadsheetApp.flush();   // results are on the sheet before any pointer moves
}

function retryList_(props) {
  try { return JSON.parse(props.getProperty('RETRY') || '[]'); } catch (e) { return []; }
}

function saveRetry_(props, list) {
  if (list.length) props.setProperty('RETRY', JSON.stringify(list)); else props.deleteProperty('RETRY');
}

/** Queue failed rows as {external_id, row_hint, attempts}. When full, the oldest entries stay and one email goes out. */
function queueRetries_(ctx, failed) {
  if (!failed.length) return [];
  var list = retryList_(ctx.props), dropped = [];
  failed.forEach(function (f) {
    var same = list.filter(function (e) { return f.external_id ? e.external_id === f.external_id : e.row_hint === f.row_hint; })[0];
    if (same) { same.row_hint = f.row_hint; return; }
    var entry = { external_id: f.external_id, row_hint: f.row_hint, attempts: 1 };
    if (JSON.stringify(list.concat([entry])).length > CONFIG.RETRY_MAX_CHARS) dropped.push(f);
    else list.push(entry);
  });
  saveRetry_(ctx.props, list);
  if (dropped.length) {
    alert_('sync:retry-full', 'CallFlow CRM: retry list full',
      dropped.length + ' row(s) failed and could not be queued for retry (rows ' +
      dropped.map(function (f) { return f.row_hint; }).join(', ') + '). Their CRM Sync cell says "(retry list full)". ' +
      'Clear that cell once the cause is fixed and the hourly sweep sends them.');
  }
  return dropped;
}

/** Re-send up to one batch of queued rows. Each is found by its external_id, so moved rows still match. */
function retryQueued_(ctx) {
  var list = retryList_(ctx.props);
  if (!list.length) return;
  var batch = list.slice(0, CONFIG.BATCH_MAX), rest = list.slice(CONFIG.BATCH_MAX);
  var items = [];
  batch.forEach(function (e) {
    var at = locate_(ctx, e);
    if (at) items.push({ row: at.row, values: at.values, entry: e });   // gone from the sheet: dropped
  });
  var keep = [], gaveUp = [];
  if (items.length) {
    var results = postItems_(ctx, items);
    var stamp = Utilities.formatDate(new Date(), TZ, 'dd MMM HH:mm');
    items.forEach(function (x, i) {
      var r = results[i], e = x.entry;
      x.label = label_(r, stamp);
      if (r.result !== 'error') return;
      e.attempts += 1;
      e.row_hint = x.row;
      if (e.attempts >= CONFIG.MAX_TRIES) { x.label = 'error (gave up after ' + e.attempts + ' tries): ' + (r.error || 'unknown'); gaveUp.push(x); }
      else keep.push(e);
    });
    writeLabels_(ctx, items);
  }
  saveRetry_(ctx.props, keep.concat(rest));
  if (gaveUp.length) {
    alert_('sync:gave-up', 'CallFlow CRM: rows given up after ' + CONFIG.MAX_TRIES + ' tries',
      gaveUp.map(function (x) { return 'row ' + x.row + ': ' + x.label; }).join('\n') +
      '\n\nFix the cause, then clear the CRM Sync cell: the hourly sweep sends the row again.');
  }
}

/** The row at row_hint if it still has this external_id, else wherever that ID is now. */
function locate_(ctx, e) {
  var sheet = ctx.sheet, h = ctx.h, last = sheet.getLastRow();
  if (e.row_hint >= 2 && e.row_hint <= last) {
    var v = sheet.getRange(e.row_hint, 1, 1, h.width).getValues()[0];
    if (!e.external_id || rowId_(v, h) === e.external_id) return { row: e.row_hint, values: v };
  }
  if (!e.external_id) return null;
  if (!ctx.idIndex) {   // read the whole sheet once per run, only when a row has moved
    ctx.idIndex = {};
    if (last >= 2) {
      sheet.getRange(2, 1, last - 1, h.width).getValues().forEach(function (v, i) {
        var id = rowId_(v, h);
        if (id && !ctx.idIndex[id]) ctx.idIndex[id] = { row: i + 2, values: v };
      });
    }
  }
  return ctx.idIndex[e.external_id] || null;
}

// ── sheet helpers ───────────────────────────────────────────────────────────

function sheet_() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) throw new Error('Sheet "' + CONFIG.SHEET_NAME + '" not found');
  return sheet;
}

function pointer_(props) { return Number(props.getProperty('LAST_SYNCED_ROW') || 1); }   // row 1 = header

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

function hasLead_(v, h) {
  return ['phone', 'created_at', 'name'].some(function (k) { return String(cell_(v, h, k) || '').trim() !== ''; });
}

/** A Date cell, or text "dd/MM/yyyy HH:mm:ss" read as IST (new Date() would read it as US month/day). */
function when_(t) {
  if (t instanceof Date) return t;
  var m = String(t || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  var p = function (x) { return ('0' + x).slice(-2); };
  return new Date(m[3] + '-' + p(m[2]) + '-' + p(m[1]) + 'T' + p(m[4]) + ':' + m[5] + ':' + (m[6] || '00') + '+05:30');
}

/** The sheet's id column if it has one, else Timestamp + Contact: stable when rows are sorted or inserted. */
function rowId_(r, h) {
  var id = String(cell_(r, h, 'external_id') || '').trim();
  if (id) return id;
  var t = when_(cell_(r, h, 'created_at'));
  var digits = String(cell_(r, h, 'phone') || '').replace(/\D/g, '');
  return t && digits ? 'sheet-' + Utilities.formatDate(t, TZ, 'yyyyMMddHHmmss') + '-' + digits : '';
}

function toLead_(r, h) {
  var v = function (k) { return String(cell_(r, h, k) || '').trim(); };
  var t = when_(cell_(r, h, 'created_at'));
  return {
    // No Timestamp → no ID: leave it out (the server rejects an empty one before checking the phone)
    external_id: rowId_(r, h) || undefined, name: v('name'), phone: v('phone'), email: v('email'),
    campaign: v('campaign'), source: v('source') || 'meta', created_at: t ? t.toISOString() : '',
    status: v('status'), rep: v('rep'), amount: v('amount'), guitar: v('guitar'),
  };
}

// ── server, alerts, heartbeat, run time ─────────────────────────────────────

function apiBase_() {
  return String(PropertiesService.getScriptProperties().getProperty('API_BASE') || CONFIG.API_BASE).replace(/\/+$/, '');
}

/** A test copy (TEST_MODE=true) must never write to production. */
function guard_() {
  var test = String(PropertiesService.getScriptProperties().getProperty('TEST_MODE') || '').toLowerCase() === 'true';
  if (test && apiBase_().indexOf(CONFIG.PROD_DOMAIN) >= 0) {
    throw new Error('TEST_MODE=true but API_BASE points at production (' + CONFIG.PROD_DOMAIN + '): refusing to run');
  }
}

/** Any non-2xx answer or a timeout throws, so the rows stay unsynced and are retried next run. */
function post_(path, body) {
  var secret = PropertiesService.getScriptProperties().getProperty('CRM_SECRET');
  if (!secret) throw new Error('Script property CRM_SECRET is not set');
  var res = UrlFetchApp.fetch(apiBase_() + path, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(body),
    headers: { 'X-CRM-Secret': secret }, muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  if (code < 200 || code > 299) throw new Error('HTTP ' + code + ' from ' + path + ': ' + res.getContentText().slice(0, 200));
  var json = JSON.parse(res.getContentText());
  return json.results || json;
}

/** Healthchecks.io: success ping, or /fail so the alert is immediate. Never breaks a run. */
function hc_(key, fail) {
  try {
    var url = PropertiesService.getScriptProperties().getProperty(key);
    if (url) UrlFetchApp.fetch(url.replace(/\/+$/, '') + (fail ? '/fail' : ''), { muteHttpExceptions: true });
  } catch (e) { /* the ping is best-effort */ }
}

function fail_(job, what, e, hcKey) {
  hc_(hcKey, true);
  alert_(job + ':' + errorType_(e), 'CallFlow CRM: ' + what, String(e && e.message || e) + '\n\n' + (e && e.stack || ''));
}

/** Coarse error type, so one cause gives one email an hour even when the message text varies. */
function errorType_(e) {
  var m = String(e && e.message || e);
  var http = m.match(/^HTTP (\d{3})/);
  if (http) return 'http-' + http[1];
  if (/TEST_MODE/.test(m)) return 'guard';
  if (/CRM_SECRET|not found/.test(m)) return 'config';
  if (/lock/i.test(m)) return 'lock';
  if (/time(d)? ?out/i.test(m)) return 'timeout';
  if (/DNS|Address unavailable|unreachable|connect/i.test(m)) return 'network';
  return 'other-' + m.replace(/\d+/g, '#').replace(/[^\w#-]+/g, '_').slice(0, 40);
}

/** At most one email per type per hour; the next one says how many repeats were suppressed. Never throws. */
function alert_(type, subject, body) {
  try {
    var props = PropertiesService.getScriptProperties();
    var key = 'ALERT_' + type.slice(0, 60);
    var s = JSON.parse(props.getProperty(key) || '{"t":0,"n":0}');
    if (Date.now() - s.t < CONFIG.ALERT_EVERY_MS) { s.n += 1; props.setProperty(key, JSON.stringify(s)); return; }
    if (s.n) body += '\n\n(' + s.n + ' repeat(s) of this alert were suppressed since the last email.)';
    props.setProperty(key, JSON.stringify({ t: Date.now(), n: 0 }));
    mail_(subject, body);
  } catch (e) {
    console.error('alert failed: ' + e);
  }
}

function mail_(subject, body) {
  try {
    var to = String(PropertiesService.getScriptProperties().getProperty('ALERT_EMAILS') || '').trim() || Session.getEffectiveUser().getEmail();
    MailApp.sendEmail(to, subject, body);
  } catch (e) {
    console.error('email failed: ' + e);   // a failing alert must never crash the run
  }
}

function dayOf_(ms) { return Utilities.formatDate(new Date(ms), TZ, 'yyyy-MM-dd'); }

function add_(props, key, n) { props.setProperty(key, String(Number(props.getProperty(key) || 0) + n)); }

/** Per-day run time and run count, reported nightly. Never changes a trigger. */
function track_(started) {
  // shortcut: read-modify-write without the lock, so overlapping runs can undercount slightly; fine for a daily estimate
  try {
    var props = PropertiesService.getScriptProperties(), day = dayOf_(started);
    add_(props, 'RUN_MS_' + day, Date.now() - started);
    add_(props, 'RUNS_' + day, 1);
  } catch (e) { /* measuring must never break a run */ }
}

// ── test copies only ────────────────────────────────────────────────────────

/** TEST_MODE only: appends n fake leads by script, the way an integration writes rows (typed rows hide trigger problems). */
function testInsertRows(n) {
  if (String(PropertiesService.getScriptProperties().getProperty('TEST_MODE') || '').toLowerCase() !== 'true') {
    throw new Error('testInsertRows runs only with the script property TEST_MODE=true (on a copy of the sheet)');
  }
  guard_();
  n = typeof n === 'number' && n > 0 ? n : 1;
  var sheet = sheet_(), h = headers_(sheet), now = new Date();
  var stamp = Utilities.formatDate(now, TZ, 'dd/MM/yyyy HH:mm:ss');
  var rows = [];
  for (var i = 0; i < n; i++) {
    var row = []; for (var c = 0; c < h.width; c++) row.push('');
    var set = function (k, v) { if (h.cols[k] >= 0) row[h.cols[k]] = v; };
    set('created_at', stamp);
    set('name', 'Test Lead ' + Utilities.formatDate(now, TZ, 'HHmmss') + '-' + (i + 1));
    set('phone', '90009' + String(Math.floor(Math.random() * 1e5)).padStart(5, '0'));
    set('source', 'Test');
    rows.push(row);
  }
  sheet.getRange(sheet.getLastRow() + 1, 1, n, h.width).setValues(rows);
}

/** TEST_MODE only: appends a copy of the last row (same Timestamp + Contact = same ID → "duplicate"). */
function testInsertDuplicate() {
  if (String(PropertiesService.getScriptProperties().getProperty('TEST_MODE') || '').toLowerCase() !== 'true') {
    throw new Error('testInsertDuplicate runs only with the script property TEST_MODE=true (on a copy of the sheet)');
  }
  guard_();
  var sheet = sheet_(), h = headers_(sheet), last = sheet.getLastRow();
  var row = sheet.getRange(last, 1, 1, h.width).getValues()[0];
  row[h.sync - 1] = '';
  sheet.getRange(last + 1, 1, 1, h.width).setValues([row]);
}
