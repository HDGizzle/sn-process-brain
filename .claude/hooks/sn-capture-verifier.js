#!/usr/bin/env node
/*
 * PostToolUse hook — sn-capture-verifier (Bash + PowerShell matchers)
 *
 * THE deterministic enforcement layer: after an agent-API config write, query
 * sys_update_xml via the live sn-scriptsync agent API and report — loudly — whether the
 * write was captured, and by WHICH update set. Post-write verification of observable
 * state beats pre-write blocking on unobservable state (the update-set truth lives in
 * the browser session, where no hook can see it).
 *
 * Instance resolution: SN_HOOK_INSTANCE env var, else product.config.json
 * instances.dev. No configured instance -> exits silently.
 *
 * Fail-open: no port file / API down / timeout -> exits silently (the kernel rule still
 * demands manual verification; this hook is an automation of it, not its replacement).
 */
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');

var WRITE_RE = /create_artifact|update_record(_batch)?|create_table|add_column/;
var SYS_ID_RE = /\b[0-9a-f]{32}\b/g;
var TIMEOUT_MS = 2500;
var MAX_VERIFY = 3;

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'product.config.json'), 'utf8').replace(/^\uFEFF/, ''));
  } catch (noConfig) { return {}; }
}

var config = loadConfig();
var configuredDev = (config.instances && config.instances.dev) || '';
if (/^(REQUIRED|OPTIONAL)\b/.test(configuredDev)) { configuredDev = ''; } // unfilled slot
var INSTANCE = process.env.SN_HOOK_INSTANCE || configuredDev;

function readStdin(cb) {
  var buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', function (chunk) { buf += chunk; });
  process.stdin.on('end', function () { cb(buf); });
}

function loadPortFile() {
  try {
    var portFile = (config.tooling && config.tooling.agentPortFile) || '.vscode/sn-agent-port.json';
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), portFile), 'utf8').replace(/^\uFEFF/, ''));
  } catch (readError) {
    return null;
  }
}

function apiQuery(portInfo, table, query, fields, cb) {
  var body = JSON.stringify({
    command: 'query_records',
    instance: INSTANCE,
    params: { table: table, query: query, fields: fields, limit: 10 }
  });
  var req = http.request({
    host: '127.0.0.1',
    port: portInfo.port,
    path: '/api',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Token': portInfo.token,
      'Content-Length': Buffer.byteLength(body)
    },
    timeout: TIMEOUT_MS
  }, function (res) {
    var data = '';
    res.setEncoding('utf8');
    res.on('data', function (chunk) { data += chunk; });
    res.on('end', function () {
      try { cb(null, JSON.parse(data)); } catch (parseError) { cb(parseError); }
    });
  });
  req.on('error', function (requestError) { cb(requestError); });
  req.on('timeout', function () { req.destroy(); cb(new Error('timeout')); });
  req.end(body);
}

readStdin(function (raw) {
  if (!INSTANCE) { process.exit(0); }

  var command = '';
  var responseText = '';
  try {
    var payload = JSON.parse(raw);
    command = String((payload.tool_input && payload.tool_input.command) || '');
    responseText = JSON.stringify(payload.tool_response || '');
  } catch (parseError) {
    process.exit(0);
  }

  if (!WRITE_RE.test(command)) { process.exit(0); }

  // Collect candidate target sys_ids from the command AND the API response
  // (create_artifact returns the new sys_id only in the response).
  var seen = {};
  var sysIds = [];
  var combined = command + ' ' + responseText;
  var match;
  while ((match = SYS_ID_RE.exec(combined)) !== null && sysIds.length < MAX_VERIFY) {
    if (!seen[match[0]]) { seen[match[0]] = true; sysIds.push(match[0]); }
  }
  if (!sysIds.length) { process.exit(0); }

  var portInfo = loadPortFile();
  if (!portInfo || !portInfo.port || !portInfo.token) { process.exit(0); }

  var results = [];
  var pending = sysIds.length;
  sysIds.forEach(function (sysId) {
    apiQuery(portInfo, 'sys_update_xml', 'nameLIKE' + sysId,
      'name,action,update_set.name,sys_updated_on', function (queryError, apiResponse) {
        if (!queryError && apiResponse && apiResponse.result) {
          var rows = apiResponse.result.records || [];
          if (rows.length === 0) {
            results.push('NOT CAPTURED: ' + sysId +
              ' has NO sys_update_xml row. Either this is a non-tracked data table (fine) or the ' +
              'write went to no update set / silently no-opped. VERIFY DELIBERATELY before moving on.');
          } else {
            var latest = rows[rows.length - 1];
            var setName = latest['update_set.name'] || '(unknown set)';
            var lineSummary = 'captured: ' + (latest.name || sysId) + ' -> update set "' + setName + '"';
            if (/^default$/i.test(String(setName))) {
              results.push('!! WRONG SET — ' + lineSummary + ' — Default is FORBIDDEN. Force-move this record to the story update set now.');
            } else {
              results.push(lineSummary);
            }
          }
        }
        pending -= 1;
        if (pending === 0) { emit(results); }
      });
  });

  function emit(lines) {
    if (!lines.length) { process.exit(0); }
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: 'CAPTURE-VERIFIER (sys_update_xml ground truth):\n' + lines.join('\n')
      }
    }));
    process.exit(0);
  }
});
