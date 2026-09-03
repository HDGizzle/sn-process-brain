// ============================================================
// EXAMPLE: Delete fields from tables
// ============================================================
// Run in: Background Scripts (Global scope)
// Use case: Remove fields that were accidentally created on wrong tables
// This script deletes: sys_dictionary, sys_documentation, sys_choice, sys_choice_set
//
// HARD RULE: present the exact field list to the user and get explicit
// confirmation BEFORE running any delete script.
// ============================================================

// Define the fields to delete: { table: 'table_name', element: 'field_name' }
// (example tables shown — replace with your own)
var fieldsToDelete = [
    { table: 'x_acme_fm_case', element: 'u_example_field' },
    { table: 'x_acme_fm_task', element: 'u_another_example' }
];

var deletedDict = [];
var deletedDoc = [];
var deletedChoice = [];
var deletedChoiceSet = [];
var notFound = [];

for (var i = 0; i < fieldsToDelete.length; i++) {
    var f = fieldsToDelete[i];
    var tableName = f.table;
    var fieldName = f.element;
    var key = tableName + '.' + fieldName;

    // Delete sys_dictionary records (field definition)
    var dict = new GlideRecord('sys_dictionary');
    dict.addQuery('name', tableName);
    dict.addQuery('element', fieldName);
    dict.query();

    var foundDict = false;
    while (dict.next()) {
        var dictId = '' + dict.sys_id;
        dict.deleteRecord();
        deletedDict.push({ field: key, sys_id: dictId });
        foundDict = true;
    }

    // Delete sys_documentation records (translations)
    var doc = new GlideRecord('sys_documentation');
    doc.addQuery('name', tableName);
    doc.addQuery('element', fieldName);
    doc.query();

    while (doc.next()) {
        var docId = '' + doc.sys_id;
        var lang = '' + doc.language;
        doc.deleteRecord();
        deletedDoc.push({ field: key, language: lang, sys_id: docId });
    }

    // Delete sys_choice records (choice values)
    var choice = new GlideRecord('sys_choice');
    choice.addQuery('name', tableName);
    choice.addQuery('element', fieldName);
    choice.query();

    while (choice.next()) {
        var choiceId = '' + choice.sys_id;
        var choiceVal = '' + choice.value;
        choice.deleteRecord();
        deletedChoice.push({ field: key, value: choiceVal, sys_id: choiceId });
    }

    // Delete sys_choice_set records (choice list parent)
    var choiceSet = new GlideRecord('sys_choice_set');
    choiceSet.addQuery('name', tableName);
    choiceSet.addQuery('element', fieldName);
    choiceSet.query();

    while (choiceSet.next()) {
        var csId = '' + choiceSet.sys_id;
        choiceSet.deleteRecord();
        deletedChoiceSet.push({ field: key, sys_id: csId });
    }

    if (!foundDict) {
        notFound.push(key);
    }
}

gs.info('============================================================');
gs.info('FIELD DELETION COMPLETE');
gs.info('============================================================');
gs.info('Deleted sys_dictionary records: ' + deletedDict.length);
gs.info('Deleted sys_documentation records: ' + deletedDoc.length);
gs.info('Deleted sys_choice records: ' + deletedChoice.length);
gs.info('Deleted sys_choice_set records: ' + deletedChoiceSet.length);
gs.info('Not found: ' + notFound.length);
gs.info('============================================================');
gs.info('DELETED_DICT: ' + JSON.stringify(deletedDict));
gs.info('DELETED_DOC: ' + JSON.stringify(deletedDoc));
gs.info('DELETED_CHOICE: ' + JSON.stringify(deletedChoice));
gs.info('DELETED_CHOICE_SET: ' + JSON.stringify(deletedChoiceSet));
if (notFound.length > 0) {
    gs.info('NOT_FOUND: ' + JSON.stringify(notFound));
}
