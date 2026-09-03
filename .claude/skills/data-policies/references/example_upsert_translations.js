// ============================================================
// EXAMPLE: Upsert field-label translations (insert or update)
// ============================================================
// Run in: Background Scripts (Global scope)
// Use case: When translations may already exist and need updating
// This variant UPDATES existing translations instead of skipping
//
// Fill in before running:
//   SCOPE_ID        — sys_id of your scoped app's sys_scope row
//                     (verify on your instance; never use the scope name string)
//   TARGET_TABLE    — table whose field labels you are translating
//   TARGET_LANGUAGE — a language code from product.config.json language.targets
// ============================================================

var SCOPE_ID = '<scope_sys_id>';
var TARGET_TABLE = 'x_acme_fm_case'; // example table
var TARGET_LANGUAGE = '<target_lang>'; // e.g. from product.config.json language.targets

var translations = [
    {
        element: 'u_example_field',
        label: '<translated label for Example Field>',
        language: TARGET_LANGUAGE
    },
    {
        element: 'u_another_field',
        label: '<translated label for Another Field>',
        language: TARGET_LANGUAGE
    }
];

var created = [];
var updated = [];

for (var i = 0; i < translations.length; i++) {
    var t = translations[i];
    var key = TARGET_TABLE + '.' + t.element + ' [' + t.language + ']';

    // Check if exists
    var existing = new GlideRecord('sys_documentation');
    existing.addQuery('name', TARGET_TABLE);
    existing.addQuery('element', t.element);
    existing.addQuery('language', t.language);
    existing.query();

    if (existing.next()) {
        // UPDATE existing record
        var oldLabel = '' + existing.label;
        existing.label = t.label;
        existing.sys_scope = SCOPE_ID;
        existing.sys_package = SCOPE_ID;
        existing.update();
        updated.push({ field: key, sys_id: '' + existing.sys_id, old_label: oldLabel, new_label: t.label });
    } else {
        // INSERT new record
        var doc = new GlideRecord('sys_documentation');
        doc.initialize();
        doc.name = TARGET_TABLE;
        doc.element = t.element;
        doc.label = t.label;
        doc.language = t.language;
        doc.sys_scope = SCOPE_ID;
        doc.sys_package = SCOPE_ID;

        var sysId = doc.insert();
        if (sysId) {
            created.push({ field: key, sys_id: '' + sysId });
        }
    }
}

gs.info('============================================================');
gs.info('TRANSLATION UPSERT COMPLETE - ' + TARGET_TABLE);
gs.info('Created: ' + created.length);
gs.info('Updated: ' + updated.length);
gs.info('============================================================');
gs.info('CREATED_TRANSLATIONS: ' + JSON.stringify(created));
gs.info('UPDATED_TRANSLATIONS: ' + JSON.stringify(updated));
