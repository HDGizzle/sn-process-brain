// ============================================================
// EXAMPLE: INSERT CHILD TEST RECORDS
// ============================================================
// Run in: Background Scripts (runs in GLOBAL scope — sys_scope
// is set explicitly below).
// PREREQUISITE: run example_insert_parent_records.js first and
// paste its PARENT_SYSID_MAP output into PARENT_MAP below.
// Table:  x_acme_fm_case_detail (placeholder — substitute your
//         child table; 'case' is its reference field to the parent)
// Data:   obviously-fake example data — replace before use.
// ============================================================

var SCOPE_ID = '<scope_sys_id>'; // sys_id of the x_acme_fm scope record

// Example of mapping source-system display values to ServiceNow
// choice values (pattern for imported/legacy test data).
var SEVERITY_MAP = {
    'Minor': 'minor',
    'Moderate': 'moderate',
    'Serious': 'serious',
    'Other': 'other'
};

// Parent sys_ids from example_insert_parent_records.js output.
// Values below are placeholders — replace with your actual output.
var PARENT_MAP = {
    'TEST-CASE-0001': '00000000000000000000000000000001',
    'TEST-CASE-0002': '00000000000000000000000000000002',
    'TEST-CASE-0003': '00000000000000000000000000000003'
};

var testRecords = [
    {
        ref: 'TEST-DETAIL-0001',
        parentRef: 'TEST-CASE-0001',
        short_description: 'Detail for case 1: broken guard rail',
        severity: SEVERITY_MAP['Minor'],
        follow_up_required: false
    },
    {
        ref: 'TEST-DETAIL-0002',
        parentRef: 'TEST-CASE-0002',
        short_description: 'Detail for case 2: badge reader offline',
        severity: SEVERITY_MAP['Moderate'],
        follow_up_required: true
    },
    {
        ref: 'TEST-DETAIL-0003',
        parentRef: 'TEST-CASE-0003',
        short_description: 'Detail for case 3: missing signage',
        severity: SEVERITY_MAP['Minor'],
        follow_up_required: true
    }
];

var created = [];
var skipped = [];
var failed = [];

for (var i = 0; i < testRecords.length; i++) {
    var t = testRecords[i];
    var parentSysId = PARENT_MAP[t.parentRef];

    if (!parentSysId) {
        failed.push({ ref: t.ref, error: 'No parent sys_id for ' + t.parentRef });
        continue;
    }

    // Dedup: skip if a record with this external reference already exists.
    // NOTE: 'external_reference' must EXIST on x_acme_fm_case_detail —
    // an unknown field returns ALL rows and the script would silently
    // treat an unrelated record as "already inserted" (see SKILL.md hard rule).
    var existing = new GlideRecord('x_acme_fm_case_detail');
    existing.addQuery('external_reference', t.ref);
    existing.query();

    if (existing.hasNext()) {
        existing.next();
        skipped.push({ ref: t.ref, sys_id: '' + existing.sys_id });
        continue;
    }

    var gr = new GlideRecord('x_acme_fm_case_detail');
    gr.initialize();
    gr.setValue('external_reference', t.ref);
    gr.setValue('case', parentSysId); // reference to parent
    gr.setValue('short_description', t.short_description);
    gr.setValue('severity', t.severity);
    gr.setValue('follow_up_required', t.follow_up_required);
    gr.sys_scope = SCOPE_ID;

    var sysId = gr.insert();
    if (sysId) {
        created.push({ ref: t.ref, sys_id: '' + sysId });
    } else {
        failed.push({ ref: t.ref, error: 'Insert failed' });
    }
}

gs.info('============================================================');
gs.info('CHILD TEST DATA INSERTION COMPLETE');
gs.info('============================================================');
gs.info('Created: ' + created.length);
gs.info('Skipped (already exist): ' + skipped.length);
gs.info('Failed: ' + failed.length);

for (var j = 0; j < created.length; j++) {
    gs.info('  CREATED ' + created[j].ref + ' -> ' + created[j].sys_id);
}
for (var k = 0; k < failed.length; k++) {
    gs.error('  FAILED ' + failed[k].ref + ': ' + failed[k].error);
}
