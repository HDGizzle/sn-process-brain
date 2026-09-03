#!/usr/bin/env node
/*
 * PreToolUse hook — sn-write-guard (Bash + PowerShell + Write/Edit matchers)
 *
 * Warn-grade, stateless safety net for agent-API writes. Honest scope: this hook CANNOT
 * block reliably (payloads travel via files/heredocs and the update-set truth lives in
 * the browser session) — it injects the rules at the moment of writing and routes DELETE
 * verbs to the real human permission prompt via permissionDecision:"ask". Deterministic
 * capture checking is the PostToolUse verifier's job.
 *
 * Covers all three transports: shell curl/Invoke-RestMethod (Bash+PowerShell matchers)
 * and the file-queue transport (Write/Edit on agent/requests/*.json).
 */
'use strict';

var fs = require('fs');
var path = require('path');

var WRITE_RE = /create_artifact|update_record(_batch)?|create_application|create_table|add_column|run_background_script|switch_context/;
var DELETE_RE = /delete_record|delete_application|"method"\s*:\s*"DELETE"|deleteRecord\s*\(|deleteMultiple(Records)?\s*\(/i;
var JOURNAL_SETVALUE_RE = /setValue\s*\(\s*['"](work_notes|comments)['"]/;
var M2M_RE = /(sys_group_has_role|sys_user_has_role|sys_user_grmember|sys_user_role_contains)[\s\S]{0,400}?\.update\s*\(/;

function wikiRoot() {
  try {
    var config = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'product.config.json'), 'utf8').replace(/^\uFEFF/, ''));
    return (config.paths && config.paths.wikiRoot) || 'docs/wiki';
  } catch (noConfig) { return 'docs/wiki'; }
}

function readStdin(cb) {
  var buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', function (chunk) { buf += chunk; });
  process.stdin.on('end', function () { cb(buf); });
}

readStdin(function (raw) {
  var text = '';
  var toolName = '';
  try {
    var payload = JSON.parse(raw);
    toolName = (payload && payload.tool_name) || '';
    var input = (payload && payload.tool_input) || {};
    if (toolName === 'Write' || toolName === 'Edit') {
      // File-queue transport only: agent/requests/req_*.json
      var filePath = String(input.file_path || '');
      if (!/agent[\\/]requests[\\/].*\.json$/i.test(filePath)) { process.exit(0); }
      text = String(input.content || '') + String(input.new_string || '');
    } else {
      text = String(input.command || '');
    }
  } catch (parseError) {
    process.exit(0); // not parseable -> stay out of the way (fail-open)
  }

  var isWrite = WRITE_RE.test(text);
  var isDelete = DELETE_RE.test(text);
  if (!isWrite && !isDelete) { process.exit(0); }

  // Destructive verbs -> the REAL human gate (never a model-writable token).
  if (isDelete) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason:
          'DELETE-CLASS ServiceNow operation detected (incl. bg-script/scoped-SI delete helpers). ' +
          'Hard rule: present the exact list of records to delete and get explicit user confirmation first. ' +
          'Approve only if that confirmation already happened in this conversation.'
      }
    }));
    process.exit(0);
  }

  var warnings = [
    'WRITE-GUARD (advisory — the deterministic check is the post-write capture verifier):',
    '1. Correct STORY-NAMED update set active? Never Default; wrong scope -> same-named set in that scope first.',
    '2. BOTH switch_context calls done (updateset AND application)? Skipping the app switch = silent no-op ("success", record unchanged).',
    '3. create_artifact scope param = scope SYS_ID, never the abbreviation string.',
    '4. After the write: verify sys_updated_on moved AND sys_update_xml captured it (verifier hook reports).',
    'Corrections page: ' + wikiRoot() + '/agent-api.md — it OVERRIDES the vendor agentinstructions.'
  ];
  if (JOURNAL_SETVALUE_RE.test(text)) {
    warnings.push('!! setValue on a JOURNAL field detected — silently posts NOTHING. Use direct assignment (gr.work_notes = text) or setJournalEntry.');
  }
  if (M2M_RE.test(text)) {
    warnings.push('!! UPDATE on an M2M relationship table detected — platform rejects it but Rhino does not throw. Use DELETE + INSERT.');
  }

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: warnings.join('\n')
    }
  }));
  process.exit(0);
});
