// ============================================================
// EXAMPLE: INSERT RELATED TEST RECORDS
// ============================================================
// Run in: Background Scripts (runs in GLOBAL scope — sys_scope
// is set explicitly below).
// PREREQUISITE: run example_insert_parent_records.js first and
// paste its PARENT_SYSID_MAP output into PARENT_MAP below.
// Table:  x_acme_fm_case_contact (placeholder — a related/party
//         table with 'case' (ref to parent), 'type' (choice) and
//         'user' (ref to sys_user) fields)
// Data:   obviously-fake example data (jane.doe@example.com,
//         EMP0001) — replace before use.
// ============================================================

var SCOPE_ID = '<scope_sys_id>'; // sys_id of the x_acme_fm scope record

// Parent sys_ids from example_insert_parent_records.js output.
// Values below are placeholders — replace with your actual output.
var PARENT_MAP = {
    'TEST-CASE-0001': '00000000000000000000000000000001',
    'TEST-CASE-0002': '00000000000000000000000000000002',
    'TEST-CASE-0003': '00000000000000000000000000000003'
};

var testRecords = [
    {
        parentRef: 'TEST-CASE-0001',
        employee_number: 'EMP0001', // e.g. test user jane.doe@example.com
        type: 'reporter'
    },
    {
        parentRef: 'TEST-CASE-0002',
        employee_number: 'EMP0001',
        type: 'affected_person'
    },
    {
        parentRef: 'TEST-CASE-0003',
        employee_number: 'EMP0002', // e.g. test user john.smith@example.com
        type: 'witness'
    }
];

var created = [];
var skipped = [];
var failed = [];

// Helper: resolve a sys_user by employee number (returns null if absent)
function findUserByEmployeeNumber(empNum) {
    var user = new GlideRecord('sys_user');
    user.addQuery('employee_number', empNum);
    user.query();
    if (user.next()) {
        return '' + user.sys_id;
    }
    return null;
}

for (var i = 0; i < testRecords.length; i++) {
    var t = testRecords[i];
    var parentSysId = PARENT_MAP[t.parentRef];

    if (!parentSysId) {
        failed.push({ parentRef: t.parentRef, error: 'No parent sys_id' });
        continue;
    }

    // Dedup: one contact per (case, type) combination.
    // Both fields verified to exist on the table (see SKILL.md hard rule).
    var existing = new GlideRecord('x_acme_fm_case_contact');
    existing.addQuery('case', parentSysId);
    existing.addQuery('type', t.type);
    existing.query();

    if (existing.hasNext()) {
        existing.next();
        skipped.push({ parentRef: t.parentRef, sys_id: '' + existing.sys_id });
        continue;
    }

    // Resolve user (optional — the test user may not exist on this instance)
    var userSysId = findUserByEmployeeNumber(t.employee_number);
    if (!userSysId) {
        gs.warn('User not found for employee_number=' + t.employee_number +
            ' — inserting contact without user reference');
    }

    var gr = new GlideRecord('x_acme_fm_case_contact');
    gr.initialize();
    gr.setValue('case', parentSysId);
    gr.setValue('type', t.type);
    if (userSysId) {
        gr.setValue('user', userSysId);
    }
    gr.sys_scope = SCOPE_ID;

    var sysId = gr.insert();
    if (sysId) {
        created.push({ parentRef: t.parentRef, type: t.type, sys_id: '' + sysId });
    } else {
        failed.push({ parentRef: t.parentRef, error: 'Insert failed' });
    }
}

gs.info('============================================================');
gs.info('RELATED TEST DATA INSERTION COMPLETE');
gs.info('============================================================');
gs.info('Created: ' + created.length);
gs.info('Skipped (already exist): ' + skipped.length);
gs.info('Failed: ' + failed.length);

for (var j = 0; j < created.length; j++) {
    gs.info('  CREATED ' + created[j].parentRef + ' [' + created[j].type + '] -> ' + created[j].sys_id);
}
for (var k = 0; k < failed.length; k++) {
    gs.error('  FAILED ' + failed[k].parentRef + ': ' + failed[k].error);
}
