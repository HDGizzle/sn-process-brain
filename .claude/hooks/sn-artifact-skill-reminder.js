#!/usr/bin/env node
/*
 * PreToolUse / Bash hook — sn-artifact-skill-reminder
 *
 * Fires on Bash tool calls that write a ServiceNow artifact via the sn-scriptsync
 * agent API (create_artifact / update_record / update_record_batch / create_table /
 * add_column / create_application). When the command targets a skill-governed table,
 * it injects a verification reminder listing that table's documented silent-fail
 * gotchas (loaded from table-gotchas.json — extend that file per customer).
 *
 * WHY this exists: the UserPromptSubmit skill-trigger fires on the USER's prompts,
 * so artifacts created autonomously mid-build (executing a blueprint) are never
 * covered. This hook fires on the write ITSELF, giving a per-artifact checkpoint to
 * confirm the relevant skill was loaded and the config fields are correct.
 *
 * NON-BLOCKING by design: always allows the tool; only injects context. A reminder
 * can't break a build. Upgrade to blocking (exit 2) later if the team wants it.
 */
'use strict';

var fs = require('fs');
var path = require('path');

var WRITE_RE = /create_artifact|update_record(_batch)?|create_application|create_table|add_column/;

function loadGotchas() {
  try {
    var parsed = JSON.parse(fs.readFileSync(path.join(__dirname, 'table-gotchas.json'), 'utf8').replace(/^\uFEFF/, ''));
    delete parsed.$comment;
    return parsed;
  } catch (noFile) { return {}; }
}

function readStdin(cb) {
  var buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', function (chunk) { buf += chunk; });
  process.stdin.on('end', function () { cb(buf); });
}

readStdin(function (raw) {
  var command = '';
  try {
    var payload = JSON.parse(raw);
    command = (payload && payload.tool_input && payload.tool_input.command) || '';
  } catch (parseError) {
    process.exit(0); // not parseable -> stay out of the way
  }

  if (!WRITE_RE.test(command)) {
    process.exit(0); // not an artifact write (queries etc.) -> no reminder
  }

  var TABLE_GOTCHAS = loadGotchas();
  var hits = [];
  for (var table in TABLE_GOTCHAS) {
    if (!TABLE_GOTCHAS.hasOwnProperty(table)) { continue; }
    // Match as a JSON value ("table") or a standalone word token. The word
    // boundary keeps `sys_script` from matching `sys_script_client/_include`
    // (the underscore is a word char, so there is no boundary between them).
    var re = new RegExp('["\']' + table + '["\']|\\b' + table + '\\b');
    if (re.test(command)) {
      hits.push('- ' + table + ': ' + TABLE_GOTCHAS[table]);
    }
  }

  if (!hits.length) { process.exit(0); }

  var context =
    'SKILL-GATE: this Bash call writes a ServiceNow artifact via the agent API. ' +
    'Confirm the matching skill was loaded BEFORE you built this payload, and VERIFY the ' +
    'config fields against it now (field names, ui_type, references are common silent-fail spots):\n' +
    hits.join('\n') +
    '\nIf the skill was not loaded, re-check this artifact and fix any silently-failing fields.';

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: context
    }
  }));
  process.exit(0);
});
