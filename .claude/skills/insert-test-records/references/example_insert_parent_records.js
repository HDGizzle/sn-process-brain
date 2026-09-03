// ============================================================
// EXAMPLE: INSERT PARENT TEST RECORDS
// ============================================================
// Run in: Background Scripts (runs in GLOBAL scope — sys_scope
// is set explicitly below).
// Table:  x_acme_fm_case (placeholder — substitute your parent table)
// Data:   obviously-fake example data — replace before use.
// Prints a ref -> sys_id map for the child/related record scripts.
//
// HARD RULE reminder: verify that the dedup field
// ('external_reference' here) actually EXISTS on the target table
// (sys_dictionary: name=<table>^element=external_reference) before
// running. An unknown field makes the query return ALL rows and the
// script will "re-link" an unrelated existing record.
// ============================================================

var SCOPE_ID = '<scope_sys_id>'; // sys_id of the x_acme_fm scope record (sys_scope)

var testRecords = [
    {
        ref: 'TEST-CASE-0001',
        short_description: 'Example case: equipment malfunction reported',
        category: 'equipment',
        state: '1',
        priority: '3',
        opened_at: '2026-01-01 09:00:00'
    },
    {
        ref: 'TEST-CASE-0002',
        short_description: 'Example case: facility access request',
        category: 'access',
        state: '1',
        priority: '2',
        opened_at: '2026-01-01 09:15:00'
    },
    {
        ref: 'TEST-CASE-0003',
        short_description: 'Example case: workplace inspection follow-up',
        category: 'inspection',
        state: '1',
        priority: '4',
        opened_at: '2026-01-01 09:30:00'
    }
];

var created = [];
var skipped = [];
var failed = [];

for (var i = 0; i < testRecords.length; i++) {
    var t = testRecords[i];

    // Dedup: skip if a record with this external reference already exists
    var existing = new GlideRecord('x_acme_fm_case');
    existing.addQuery('external_reference', t.ref);
    existing.query();

    if (existing.hasNext()) {
        existing.next();
        skipped.push({
            ref: t.ref,
            sys_id: '' + existing.sys_id,
            number: '' + existing.number
        });
        continue;
    }

    var gr = new GlideRecord('x_acme_fm_case');
    gr.initialize();
    gr.setValue('external_reference', t.ref);
    gr.setValue('short_description', t.short_description);
    gr.setValue('category', t.category);
    gr.setValue('state', t.state);
    gr.setValue('priority', t.priority);
    gr.setValue('opened_at', t.opened_at);
    gr.sys_scope = SCOPE_ID;

    var sysId = gr.insert();
    if (sysId) {
        created.push({
            ref: t.ref,
            sys_id: '' + sysId,
            number: '' + gr.number
        });
    } else {
        failed.push({ ref: t.ref, error: 'Insert failed' });
    }
}

gs.info('============================================================');
gs.info('PARENT TEST DATA INSERTION COMPLETE');
gs.info('============================================================');
gs.info('Created: ' + created.length);
gs.info('Skipped (already exist): ' + skipped.length);
gs.info('Failed: ' + failed.length);

gs.info('CREATED_RECORDS:');
for (var j = 0; j < created.length; j++) {
    gs.info('  ' + created[j].ref + ' -> ' + created[j].sys_id + ' (' + created[j].number + ')');
}

if (skipped.length > 0) {
    gs.info('SKIPPED_RECORDS:');
    for (var k = 0; k < skipped.length; k++) {
        gs.info('  ' + skipped[k].ref + ' -> ' + skipped[k].sys_id + ' (' + skipped[k].number + ')');
    }
}

// Paste this map into the child/related record scripts:
gs.info('PARENT_SYSID_MAP: ' + JSON.stringify(created.concat(skipped)));
