#!/usr/bin/env node
/*
 * UserPromptSubmit hook — skill-trigger
 *
 * Derives skill routing FROM SKILL FRONTMATTER AT RUNTIME — single source, zero
 * regeneration step. (The predecessor design, a hand-maintained regex table, drifted
 * from the skill tree within weeks; frontmatter-derived routing cannot drift.)
 *
 * Mechanism: for every .claude/skills/<name>/SKILL.md, harvest the quoted trigger
 * phrases from the frontmatter `description:` ("create ACL", "decision table", ...).
 * Match phrases case-insensitively against the user prompt; remind for the top hits.
 * A skill with no quoted phrases in its description is simply not phrase-routed (its
 * description still auto-routes via the harness skill listing).
 */
'use strict';

var fs = require('fs');
var path = require('path');

var MAX_SKILLS_REMINDED = 4;
var MIN_PHRASE_LEN = 4; // skip junk phrases like "BR" unless exact-word matched

function readStdin(cb) {
  var buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', function (chunk) { buf += chunk; });
  process.stdin.on('end', function () { cb(buf); });
}

function harvestSkills(skillsDir) {
  var skills = [];
  var entries;
  try { entries = fs.readdirSync(skillsDir); } catch (noDir) { return skills; }
  entries.forEach(function (skillName) {
    var md = '';
    try {
      md = fs.readFileSync(path.join(skillsDir, skillName, 'SKILL.md'), 'utf8');
    } catch (noUpper) {
      try { md = fs.readFileSync(path.join(skillsDir, skillName, 'skill.md'), 'utf8'); } catch (noLower) { return; }
    }
    md = md.replace(/\r\n/g, '\n'); // Windows checkouts: normalize before any line-anchored regex
    var fmMatch = md.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) { return; }
    var descMatch = fmMatch[1].match(/^description:\s*([\s\S]*?)(?=\n[a-zA-Z_-]+:|\n*$)/m);
    if (!descMatch) { return; }
    var phrases = [];
    var phraseRe = /"([^"]{2,60})"/g;
    var m;
    while ((m = phraseRe.exec(descMatch[1])) !== null) { phrases.push(m[1]); }
    if (phrases.length) { skills.push({ name: skillName, phrases: phrases }); }
  });
  return skills;
}

readStdin(function (raw) {
  var prompt = '';
  try {
    var payload = JSON.parse(raw);
    prompt = String(payload.prompt || payload.user_prompt || '');
  } catch (parseError) { process.exit(0); }
  if (!prompt || prompt.length < 8) { process.exit(0); }

  var promptLower = prompt.toLowerCase();
  var skills = harvestSkills(path.join(process.cwd(), '.claude', 'skills'));
  var hits = [];

  skills.forEach(function (skill) {
    var matched = [];
    skill.phrases.forEach(function (phrase) {
      var p = phrase.toLowerCase();
      if (p.length < MIN_PHRASE_LEN) {
        // short tokens: exact-word match only
        var wordRe = new RegExp('\\b' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
        if (wordRe.test(prompt)) { matched.push(phrase); }
      } else if (promptLower.indexOf(p) !== -1) {
        matched.push(phrase);
      }
    });
    if (matched.length) { hits.push({ name: skill.name, matched: matched, score: matched.length }); }
  });

  if (!hits.length) { process.exit(0); }
  hits.sort(function (a, b) { return b.score - a.score; });
  var top = hits.slice(0, MAX_SKILLS_REMINDED);

  var context =
    'SKILL ROUTING (frontmatter-derived): the prompt matches ' +
    top.map(function (h) { return h.name + ' (“' + h.matched[0] + '”)'; }).join(', ') +
    '. Invoke every relevant one BEFORE building; prefer the more specific on overlap. ' +
    'If none actually applies, proceed — but say so.';

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: context
    }
  }));
  process.exit(0);
});
