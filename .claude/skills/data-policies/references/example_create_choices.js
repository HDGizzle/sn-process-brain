// ============================================================
// EXAMPLE: Create choice values (multi-language)
// ============================================================
// PREREQUISITE: sys_choice_set must already exist in target scope!
// 1. Switch to target app scope in UI
// 2. Go to System Definition -> Choice Lists -> New
// 3. Create choice set for your_table.your_field
// 4. THEN run this script
//
// Languages: create one row per project language for every value.
// Source language + targets come from product.config.json
// (language.source / language.targets).
// ============================================================

var TARGET_TABLE = 'x_acme_fm_case'; // example table
var TARGET_LANGUAGE = '<target_lang>'; // e.g. from product.config.json language.targets

// Define choices per language; sequence determines display order
// (multiples of 10/100 leave room for later inserts)
var choices = [
    // Source language (example: en)
    { element: 'u_example_field', value: 'option_a', label: 'Option A', language: 'en', sequence: 100 },
    { element: 'u_example_field', value: 'option_b', label: 'Option B', language: 'en', sequence: 200 },
    { element: 'u_example_field', value: 'other', label: 'Other', language: 'en', sequence: 9999 },

    // Target language — same values, translated labels
    { element: 'u_example_field', value: 'option_a', label: '<Option A translated>', language: TARGET_LANGUAGE, sequence: 100 },
    { element: 'u_example_field', value: 'option_b', label: '<Option B translated>', language: TARGET_LANGUAGE, sequence: 200 },
    { element: 'u_example_field', value: 'other', label: '<Other translated>', language: TARGET_LANGUAGE, sequence: 9999 }
];

var created = [];
var skipped = [];

for (var i = 0; i < choices.length; i++) {
    var c = choices[i];
    var key = TARGET_TABLE + '.' + c.element + ' -> ' + c.value + ' [' + c.language + ']';

    // Check if exists
    var existing = new GlideRecord('sys_choice');
    existing.addQuery('name', TARGET_TABLE);
    existing.addQuery('element', c.element);
    existing.addQuery('value', c.value);
    existing.addQuery('language', c.language);
    existing.query();

    if (existing.hasNext()) {
        skipped.push(key);
        continue;
    }

    var choice = new GlideRecord('sys_choice');
    choice.initialize();
    choice.name = TARGET_TABLE;
    choice.element = c.element;
    choice.value = c.value;
    choice.label = c.label;
    choice.language = c.language;
    choice.sequence = c.sequence;
    choice.inactive = false;

    var sysId = choice.insert();
    if (sysId) {
        created.push({ choice: key, sys_id: '' + sysId });
    }
}

gs.info('============================================================');
gs.info('CHOICE CREATION COMPLETE - ' + TARGET_TABLE);
gs.info('Created: ' + created.length);
gs.info('Skipped: ' + skipped.length);
gs.info('============================================================');
gs.info('CREATED_CHOICES: ' + JSON.stringify(created));
