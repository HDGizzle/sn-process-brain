'use strict';
/*
 * tools/snbrain/lib/api.js — READ-ONLY sn-scriptsync agent API client.
 *
 * Ported from the the pilot customer story loop's lib/api.js, which established the rule this module
 * inherits: THIS PLATFORM FAILS SILENTLY, AND SO DOES ITS TOOLING. A stale port file, a
 * dead helper tab, or an unauthenticated instance all produce "success" with zero rows,
 * indistinguishable from "nothing matched". So every entry point either returns
 * verified-live data or THROWS. It never returns an empty result a caller could mistake
 * for a clean bill of health.
 *
 * WHAT IS NEW HERE, AND WHY. This client runs against an instance we do not own. Being
 * careful is not sufficient; it must be incapable of mutating. Four mechanisms, all
 * structural rather than advisory:
 *
 *   1. COMMAND ALLOWLIST. `READ_ONLY_COMMANDS` is a frozen Set of eight commands, out of
 *      the 43 the extension dispatches. `call()` rejects anything else BEFORE a socket is
 *      opened. Adding a write command requires editing this file, which is the point.
 *      Note what is deliberately excluded even though it looks harmless: `sync_now`
 *      flushes the pending-write queue TO the instance, and `switch_context` changes the
 *      session's update set and application scope. Neither reads anything.
 *
 *   2. REST METHOD IS A LITERAL. `rest_request` is reachable only through `restGet()`,
 *      which hardcodes `method: 'GET'`. No caller supplies a method, so no caller can
 *      smuggle one through casing, an array, or an object. GET is ungated by design in
 *      the extension (out/agent/commands/rest.js:12), which is what makes the full REST
 *      read surface available without any write capability.
 *
 *   3. ENDPOINT ALLOWLIST. Even GET mutates on some ServiceNow endpoints: processors,
 *      UI actions reached by URL, and anything honouring `sysparm_action`. `restGet()`
 *      accepts only `/api/now/{table,stats,attachment}/...` and rejects any endpoint
 *      carrying an action-ish parameter.
 *
 *   4. REQUEST LOG WRITTEN BEFORE THE SEND. Every outbound call is appended to an NDJSON
 *      log before the request leaves, so a crashed or timed-out call still appears. That
 *      is what makes read-only PROVABLE after the fact rather than merely asserted, and
 *      it is the artifact we hand to the instance owner.
 *
 * UNIQUE REQUEST IDS ARE A CORRECTNESS REQUIREMENT, NOT HYGIENE. The extension builds its
 * browser correlation id from the caller-supplied request id at ten call sites
 * (query.js:46,87; records.js:251,398,422; search.js:82; browser.js:344,374,416,494), and
 * pendingRegistry.js:25 does a plain Map.set() that silently overwrites a duplicate. Two
 * in-flight requests sharing an id cross-wire: one promise is rejected by the other's
 * timeout, and a reply resolves whichever entry currently holds the key. The the pilot customer client
 * sends no id at all, so every request there correlates as `agent_undefined`, which is
 * safe only because it never runs two calls at once. We do, so we mint a unique id per
 * call at the single choke point below.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_TIMEOUT_MS = 30000;
const PORT_FILE = path.join('.vscode', 'sn-agent-port.json');

/**
 * The eight commands this tool may issue. Verified against the installed extension at
 * out/agent/commands/ (4.7.6). Everything mutating or side-effecting is absent by
 * construction: update_record, update_record_batch, create_artifact, delete_record,
 * create_application, create_table, add_column, project, run_background_script,
 * delete_application, sync_now, switch_context, set_field, run_ui_action, click_element,
 * upload_attachment, run_slash_command, and the whole cdp.js debugger surface.
 */
const READ_ONLY_COMMANDS = Object.freeze(new Set([
  'check_connection',    // connection.js — preflight readiness
  'get_capabilities',    // connection.js — probe 8, the gates block
  'get_instance_info',   // connection.js — instance identity stamping
  'list_instances',      // connection.js — diagnostics when instance resolution fails
  'get_sync_status',     // connection.js — diagnostics only
  'query_records',       // query.js    — the R1 read path
  'get_record',          // records.js  — canary and single-record reads
  'get_table_metadata',  // records.js  — probe 4
  'rest_request',        // rest.js     — R2 read path, GET only, see restGet()
]));

/** REST endpoints we will issue a GET against. Anything else throws. */
const REST_ENDPOINT_ALLOW = [/^\/api\/now\/table\//, /^\/api\/now\/stats\//, /^\/api\/now\/attachment\//];
/** Parameters that can make a GET act. Their presence is a hard refusal. */
const REST_FORBIDDEN_PARAMS = /(^|[?&])(sysparm_action|sys_action|sysparm_processor)=/i;

class ApiError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'ApiError';
    this.detail = detail;
  }
}

/** A mutation was attempted. Separate class so callers and tests cannot conflate it. */
class ReadOnlyViolation extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReadOnlyViolation';
  }
}

// --- port file ---------------------------------------------------------------

/** Read and sanity-check the port file. Throws with an actionable message if unusable. */
function loadPort(syncRoot) {
  const portPath = path.join(syncRoot, PORT_FILE);
  let raw;
  try {
    raw = fs.readFileSync(portPath, 'utf8');
  } catch (readError) {
    throw new ApiError(
      `No agent-API port file at ${portPath}. Either sn-scriptsync is not running, or it ` +
      `elected a different folder as its sync root. Open the multi-root workspace, start ` +
      `sn-scriptsync, and confirm it syncs into ${syncRoot}.`);
  }

  let info;
  try {
    info = JSON.parse(raw);
  } catch (parseError) {
    throw new ApiError(`Port file at ${portPath} is not valid JSON. Extension wrote it mid-restart?`);
  }
  if (!info.port || !info.token) {
    throw new ApiError(`Port file at ${portPath} is missing port or token.`);
  }
  /*
   * A stale port file is the number one cause of "the API is down but nothing said so".
   *
   * PRODUCT-13: the likeliest cause is NOT that the extension died. It is that sn-scriptsync
   * RESTARTED mid-run, re-elected a different folder as its sync root — it falls back to the
   * first folder in the workspace — and wrote a fresh, live port file THERE, leaving this
   * isolated root holding the session-start copy. So the honest message names both causes and
   * the permanent fix, rather than sending the operator to restart something already running.
   *
   * Note what this deliberately does not do: go looking for the live port file. On a blind run
   * that is the move that ends the isolation, and it will not feel like cheating at the time —
   * it will feel like being helpful about a missing file. Report and stop; the operator points
   * `isolate` at the right repo.
   */
  if (info.pid && !isPidAlive(info.pid)) {
    throw new ApiError(
      `Port file at ${portPath} names PID ${info.pid}, which is not running, so this file is STALE ` +
      `(written ${info.startedAt ? new Date(info.startedAt).toISOString() : 'unknown'}).\n` +
      `Two causes, and the second is the common one:\n` +
      `  1. sn-scriptsync is not running. Start it.\n` +
      `  2. sn-scriptsync RESTARTED and re-elected a different sync root, writing a live port file\n` +
      `     there while this copy went stale. It falls back to the FIRST FOLDER IN THE WORKSPACE,\n` +
      `     which on a mapping run is often the engagement repo itself.\n` +
      `Fix: set \`sn-scriptsync.path\` explicitly in the workspace settings so the fallback can never\n` +
      `fire, then re-run \`snbrain isolate --port-from <that repo> --to ${syncRoot}\`.\n` +
      `Do NOT go looking for the live port file yourself — on a blind run that ends the isolation.`);
  }
  return info;
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // exists, just not ours
  }
}

// --- request log -------------------------------------------------------------

/**
 * Append-before-send. A record that never gets a matching outcome line is itself
 * evidence (the call crashed or timed out), which is why the write is not deferred.
 */
function makeLogger(logPath) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  return {
    path: logPath,
    sent(entry) {
      fs.appendFileSync(logPath, JSON.stringify({ phase: 'sent', at: new Date().toISOString(), ...entry }) + '\n');
    },
    done(entry) {
      fs.appendFileSync(logPath, JSON.stringify({ phase: 'done', at: new Date().toISOString(), ...entry }) + '\n');
    },
  };
}

// --- transport ---------------------------------------------------------------

function httpRequest(portInfo, urlPath, method, bodyObj, timeoutMs) {
  return new Promise((resolve, reject) => {
    const body = bodyObj ? JSON.stringify(bodyObj) : null;
    const headers = { 'X-Agent-Token': portInfo.token };
    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = http.request(
      { host: '127.0.0.1', port: portInfo.port, path: urlPath, method, headers, timeout: timeoutMs || DEFAULT_TIMEOUT_MS },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(new ApiError(`Agent API returned non-JSON (HTTP ${res.statusCode})`, data.slice(0, 400)));
          }
        });
      });
    req.on('error', (err) => reject(new ApiError(`Agent API unreachable on port ${portInfo.port}: ${err.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new ApiError(`Agent API timed out after ${timeoutMs || DEFAULT_TIMEOUT_MS}ms`)); });
    if (body) { req.write(body); }
    req.end();
  });
}

/** Verify the API is live AND is the process the port file describes. */
async function health(portInfo) {
  const res = await httpRequest(portInfo, '/api/health', 'GET', null, 8000);
  if (res.status !== 'success') {
    throw new ApiError('Agent API health check did not return success', res);
  }
  if (portInfo.pid && res.pid && String(res.pid) !== String(portInfo.pid)) {
    throw new ApiError(
      `Port-file PID (${portInfo.pid}) does not match live API PID (${res.pid}). Port file is stale.`);
  }
  if (portInfo.apiVersion && res.apiVersion && String(res.apiVersion) !== String(portInfo.apiVersion)) {
    throw new ApiError(`apiVersion mismatch: port file ${portInfo.apiVersion}, live ${res.apiVersion}.`);
  }
  return res;
}

// --- session -----------------------------------------------------------------

class Session {
  constructor(portInfo, instance, logger, budget) {
    this.portInfo = portInfo;
    this.instance = instance;
    this.logger = logger;
    this.runId = crypto.randomBytes(4).toString('hex');
    this.seq = 0;
    this.budget = budget || { max: Infinity, used: 0 };
  }

  /** The single choke point. Unique per call, so no two in-flight requests can collide. */
  nextRequestId() {
    this.seq += 1;
    return `snbrain_${this.runId}_${this.seq}`;
  }

  spend() {
    if (this.budget.used >= this.budget.max) {
      throw new ApiError(
        `Query budget exhausted (${this.budget.used}/${this.budget.max}). Refusing to issue more ` +
        `requests against ${this.instance}. Raise --budget deliberately if this was expected.`);
    }
    this.budget.used += 1;
  }

  /**
   * Issue one allowlisted command. The allowlist check precedes the budget spend and the
   * socket, so a rejected command costs nothing and touches nothing.
   */
  async call(command, params, timeoutMs) {
    if (!READ_ONLY_COMMANDS.has(command)) {
      throw new ReadOnlyViolation(
        `Command "${command}" is not on the read-only allowlist. snbrain does not issue it. ` +
        `Allowed: ${[...READ_ONLY_COMMANDS].join(', ')}.`);
    }
    this.spend();
    const id = this.nextRequestId();
    const payload = { command, id };
    if (this.instance) { payload.instance = this.instance; }
    if (params) { payload.params = params; }

    this.logger.sent({ id, command, instance: this.instance, params: redact(params) });
    let res;
    try {
      res = await httpRequest(this.portInfo, '/api', 'POST', payload, timeoutMs);
    } catch (err) {
      this.logger.done({ id, command, ok: false, error: err.message });
      throw err;
    }
    const ok = res.status === 'success';
    this.logger.done({ id, command, ok, error: ok ? undefined : (res.error || res.message) });
    if (!ok) {
      throw new ApiError(`Agent API command "${command}" failed: ${res.error || res.message || 'unknown'}`, res);
    }
    return res;
  }

  /**
   * The ONLY route to rest_request. Method is a literal, endpoint is allowlisted, and
   * action-ish parameters are refused, because GET is not universally safe on this
   * platform even though it is universally ungated in the extension.
   */
  async restGet(endpoint, queryParams, timeoutMs) {
    if (typeof endpoint !== 'string' || !endpoint.startsWith('/')) {
      throw new ReadOnlyViolation(`restGet endpoint must be an instance-relative path, got: ${String(endpoint)}`);
    }
    if (!REST_ENDPOINT_ALLOW.some((re) => re.test(endpoint))) {
      throw new ReadOnlyViolation(
        `Endpoint "${endpoint}" is outside the read allowlist (/api/now/table, /api/now/stats, /api/now/attachment).`);
    }
    if (REST_FORBIDDEN_PARAMS.test(endpoint)) {
      throw new ReadOnlyViolation(`Endpoint "${endpoint}" carries an action parameter; a GET could mutate.`);
    }
    for (const key of Object.keys(queryParams || {})) {
      if (/^(sysparm_action|sys_action|sysparm_processor)$/i.test(key)) {
        throw new ReadOnlyViolation(`Query parameter "${key}" could make a GET act. Refused.`);
      }
    }
    const res = await this.call('rest_request', {
      endpoint,
      method: 'GET', // literal, never caller-supplied
      queryParams: queryParams || undefined,
    }, timeoutMs);

    /*
     * rest.js returns { status, data }: the HTTP status of the ServiceNow call and the
     * parsed body. Unwrap here so callers see the ServiceNow body directly and read rows
     * at `.result` exactly as the REST API documents them.
     *
     * The status check is not cosmetic. Without it a 401/403/404 arrives as a perfectly
     * successful agent-API response whose body simply has no `result` array, and every
     * caller reads that as "zero rows". That is the platform's signature failure mode
     * reproduced inside our own client, so a non-2xx is raised as an error here and can
     * never be mistaken for an empty table.
     */
    const envelope = res.result || {};
    const httpStatus = envelope.status;
    if (typeof httpStatus === 'number' && (httpStatus < 200 || httpStatus >= 300)) {
      throw new ApiError(`REST GET ${endpoint} returned HTTP ${httpStatus}`, envelope.data);
    }
    return envelope.data || {};
  }

  /**
   * Paged table read over REST. Returns { records, truncated, pages }.
   * `truncated` is explicit because a page of exactly `pageSize` is indistinguishable
   * from a complete one unless you look, and every count and absence claim depends on it.
   */
  async restTable(table, opts) {
    const o = opts || {};
    const pageSize = o.pageSize || 200;
    const maxPages = o.maxPages || 25;
    const out = [];
    let pages = 0;
    let truncated = false;
    for (let offset = 0; pages < maxPages; offset += pageSize) {
      const qp = {
        sysparm_limit: String(pageSize),
        sysparm_offset: String(offset),
        sysparm_display_value: 'false',        // stored values, never localized display text
        sysparm_exclude_reference_link: 'true',
      };
      if (o.query) { qp.sysparm_query = o.query; }
      if (o.fields) { qp.sysparm_fields = Array.isArray(o.fields) ? o.fields.join(',') : o.fields; }
      const body = await this.restGet(`/api/now/table/${table}`, qp);
      const rows = (body && body.result) || [];
      out.push(...rows.map(flattenRefs));
      pages += 1;
      if (rows.length < pageSize) { break; }
      if (pages >= maxPages) { truncated = true; }
    }
    return { records: out, truncated, pages };
  }

  /** Aggregate count without transferring rows. Returns null when stats is unreachable. */
  async countRows(table, query) {
    const qp = { sysparm_count: 'true' };
    if (query) { qp.sysparm_query = query; }
    const body = await this.restGet(`/api/now/stats/${table}`, qp);
    const raw = body && body.result && body.result.stats && body.result.stats.count;
    return raw === undefined ? null : Number(raw);
  }

  /** Group-by counts. The distribution, not the total: they fail in opposite directions. */
  async groupCount(table, groupBy, query) {
    const qp = { sysparm_count: 'true', sysparm_group_by: groupBy };
    if (query) { qp.sysparm_query = query; }
    const body = await this.restGet(`/api/now/stats/${table}`, qp);
    const result = (body && body.result) || [];
    const rows = Array.isArray(result) ? result : [result];
    return rows.map((r) => ({
      key: r && r.groupby_fields && r.groupby_fields[0] ? r.groupby_fields[0].value : null,
      count: Number((r && r.stats && r.stats.count) || 0),
    })).filter((r) => r.key !== null);
  }

  /** R1 path, kept because probes 6 and 7 must compare R1 behaviour against R2. */
  async queryRecords(table, encodedQuery, fields, limit) {
    const res = await this.call('query_records', {
      table,
      query: encodedQuery,
      fields: Array.isArray(fields) ? fields.join(',') : fields,
      limit: limit || 200,
    });
    const records = (res.result && res.result.records) || [];
    return { records: records.map(flattenRefs), raw: res.result || {} };
  }

  /**
   * Field names present on a table. The platform silently DROPS an encoded-query clause
   * that names an unknown field and returns UNFILTERED rows, so validating before issuing
   * is the difference between a sound negative result and a confident wrong one.
   */
  /**
   * The EFFECTIVE column set for a table, inheritance resolved.
   *
   * PRODUCT-16, which is PLATFORM-2 reproduced inside our own client, and it is load-bearing:
   * field validation is the ONLY defence against the silent clause-drop, where an unknown field
   * in an encoded query returns UNFILTERED rows that look exactly like a successful broad read.
   * A validator that is blind to inherited fields is wrong in both directions — it rejects real
   * columns and, on a table whose parent happens to define the name, waves a typo through.
   *
   * The old implementation queried sys_dictionary with
   *   name=<table>^ORname=sys_metadata^elementISNOTEMPTY
   * which carried two defects. It walked exactly one level up, to sys_metadata, so a column
   * defined on `task` was invisible to every table extending it. And by PLATFORM-11 a trailing
   * clause binds only to the last ^OR leg, so `elementISNOTEMPTY` filtered the sys_metadata half
   * and not the table's own — the guard against the clause-drop was itself mis-encoded.
   *
   * `get_table_metadata` returns a `columns` map with inheritance already resolved by the
   * platform, which is the resolution PLATFORM-2 recorded after the first scope enumeration
   * aborted on a perfectly real `sys_scope.name`. The dictionary sweep remains only as a
   * fallback, and it now walks the real superclass chain via sys_db_object.super_class.
   */
  async dictionaryFields(table) {
    try {
      const meta = await this.call('get_table_metadata', { table });
      const cols = meta && (meta.columns || (meta.result && meta.result.columns));
      if (cols && typeof cols === 'object') {
        const names = Array.isArray(cols) ? cols.map((c) => c && (c.name || c.element)) : Object.keys(cols);
        const set = new Set(names.filter(Boolean));
        if (set.size) { return set; }
      }
      // An EMPTY column map for a real table is PLATFORM-12 and is not an answer. Fall through.
    } catch (unavailable) { /* fall through to the dictionary sweep */ }

    // Fallback: walk the actual superclass chain rather than assuming a single parent.
    const chain = [table];
    let cursor = table;
    for (let depth = 0; depth < 8; depth += 1) {
      const { records } = await this.restTable('sys_db_object', {
        query: `name=${cursor}`, fields: ['super_class.name'], pageSize: 1, maxPages: 1,
      });
      const parent = records[0] && (records[0]['super_class.name'] || records[0].super_class);
      if (!parent || typeof parent !== 'string' || chain.includes(parent)) { break; }
      chain.push(parent);
      cursor = parent;
    }
    // Every leg carries its own elementISNOTEMPTY: a trailing clause would bind to the last
    // leg alone, which is the mis-encoding this method used to ship.
    const query = chain.map((t) => `name=${t}^elementISNOTEMPTY`).join('^NQ');
    const { records } = await this.restTable('sys_dictionary', {
      query, fields: ['element'], pageSize: 500, maxPages: 8,
    });
    return new Set(records.map((r) => r.element).filter(Boolean));
  }
}

/** Reference fields come back as {link, value}. Flatten to the sys_id string. */
function flattenRefs(record) {
  const out = {};
  for (const [key, val] of Object.entries(record || {})) {
    if (val && typeof val === 'object' && 'value' in val) {
      out[key] = val.value;
      if (val.display_value !== undefined) { out[key + '__display'] = val.display_value; }
    } else {
      out[key] = val;
    }
  }
  return out;
}

/** The log is handed to the instance owner, so keep anything credential-shaped out of it. */
function redact(params) {
  if (!params || typeof params !== 'object') { return params; }
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    out[k] = /token|password|secret|auth/i.test(k) ? '[redacted]' : v;
  }
  return out;
}

/**
 * Open a verified session: stale-port check, health, browser readiness, positive canary.
 *
 * The canary is not ceremony. Reads against an instance with no authenticated helper tab
 * return count:0 rather than an error, so without a read that MUST return rows we cannot
 * distinguish "empty instance" from "not connected", and every downstream absence claim
 * would be unsound.
 */
async function connect(opts) {
  const { syncRoot, instance, logPath, budget, repoRoot } = opts;
  const portInfo = loadPort(syncRoot);
  const live = await health(portInfo);
  /*
   * PRODUCT-10 — THE REQUEST LOG BELONGS TO THE REPO, NOT THE SYNC ROOT.
   *
   * `snbrain isolate` builds a sync root containing nothing but `.vscode/sn-agent-port.json`
   * and warns on any other entry, because a stray file there is how a blind run stops being
   * blind. This default then wrote `spikes/scriptsync-read/snbrain-requests.ndjson` INTO that
   * sync root on the first read of the run — so `isolate` guaranteed its own "isolation
   * defeated" warning, every time, and the warning that should mean something became noise.
   *
   * The log is evidence about the RUN, and the run lives in the repo. It is also what the
   * export ships as the read-only proof, which the repo is where it has to be anyway.
   */
  const logger = makeLogger(logPath || path.join(repoRoot || syncRoot, 'spikes', 'scriptsync-read', 'snbrain-requests.ndjson'));
  const session = new Session(portInfo, instance, logger, budget);

  const conn = await session.call('check_connection', {});
  const r = (conn && conn.result) || {};
  if (!r.ready || !r.browserConnected) {
    throw new ApiError(
      `Instance "${instance}" is not ready (ready=${r.ready}, browserConnected=${r.browserConnected}). ` +
      `Reads would return empty results that look like "nothing found". Open an authenticated helper tab.`);
  }

  const canary = await session.restTable('sys_user', { query: 'sys_idISNOTEMPTY', fields: ['sys_id'], pageSize: 1, maxPages: 1 });
  if (!canary.records.length) {
    throw new ApiError(
      `CANARY FAILED: sys_user returned zero rows. Every ServiceNow instance has users, so this is ` +
      `NOT CONNECTED rather than empty. Refusing to run probes: results would be confidently wrong.`);
  }

  return { session, portInfo, live, logger, canary: canary.records.length };
}

module.exports = {
  connect, loadPort, health, flattenRefs,
  Session, ApiError, ReadOnlyViolation,
  READ_ONLY_COMMANDS, REST_ENDPOINT_ALLOW,
};
