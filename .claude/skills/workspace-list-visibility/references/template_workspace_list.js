// ============================================================
// WORKSPACE LIST VISIBILITY - Complete Template
// ============================================================
// This template creates workspace lists with role-based visibility
// Supports Mode A (full creation) and Mode B (add to existing)
// ============================================================

var SCOPE_ID = '[SCOPE_SYS_ID]';
var SCOPE_NAME = '[SCOPE_NAME]';

// ============================================================
// CONFIGURATION
// ============================================================

// CRITICAL: Get this from an existing list in the same workspace!
// Query: var gr = new GlideRecord('sys_ux_list'); gr.addQuery('sys_scope.scope', SCOPE_NAME); gr.setLimit(1); gr.query(); gr.next(); gs.info(gr.getValue('configuration'));
var CONFIG_ID = '[SYS_UX_LIST_MENU_CONFIG_SYS_ID]';

var MODE = 'A'; // 'A' = full creation, 'B' = add to existing

// Source + target languages (align with product.config.json language.source/targets)
var SOURCE_LANG = '[source_lang]'; // e.g. 'en'
var TARGET_LANG = '[target_lang]'; // e.g. a second language code, or '' for single-language

// Mode B: existing category sys_id
var EXISTING_CATEGORY_ID = '';

// Category (Mode A only)
var CATEGORY = {
    title: '[Category Title]',
    order: 100
};

// Lists to create
var LISTS = [
    {
        title: '[List Title in source language]',
        title_translated: '[List Title in target language]', // leave '' for single-language
        table: '[table_name]',
        filter: '[encoded_query]',
        columns: '[field1,field2,field3]',
        orderBy: 'ORDERBYDESCsys_created_on',
        order: 100
    }
];

// Applicability (role-based visibility)
var APPLICABILITY = {
    name: '[Applicability Name]',
    roles: '[comma_separated_role_sys_ids]'
};

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function getOrCreateApplicability(config) {
    var gr = new GlideRecord('sys_ux_applicability');
    gr.addQuery('name', config.name);
    gr.query();
    if (gr.next()) {
        gs.info('Reusing applicability: ' + config.name + ' (' + gr.getUniqueValue() + ')');
        return gr.getUniqueValue();
    }
    gr.initialize();
    gr.setValue('name', config.name);
    if (config.roles) gr.setValue('roles', config.roles);
    gr.sys_scope = SCOPE_ID;
    var id = gr.insert();
    gs.info('Created applicability: ' + config.name + ' (' + id + ')');
    return id;
}

function createTranslation(table, field, docId, lang, label) {
    var gr = new GlideRecord('sys_translated');
    gr.addQuery('documentID', docId);
    gr.addQuery('language', lang);
    gr.addQuery('fieldName', field);
    gr.query();
    if (gr.next()) {
        gr.setValue('value', label);
        gr.update();
        gs.info('Updated translation: ' + lang + ' = ' + label);
    } else {
        gr.initialize();
        gr.setValue('tableName', table);
        gr.setValue('fieldName', field);
        gr.setValue('documentID', docId);
        gr.setValue('language', lang);
        gr.setValue('value', label);
        gr.setValue('elementLabel', label); // CRITICAL: must match!
        gr.sys_scope = SCOPE_ID;
        gr.insert();
        gs.info('Created translation: ' + lang + ' = ' + label);
    }
}

// ============================================================
// STEP 1: CATEGORY (Mode A only)
// ============================================================

var categoryId;

if (MODE === 'A') {
    var cat = new GlideRecord('sys_ux_list_category');
    cat.addQuery('title', CATEGORY.title);
    cat.query();
    if (cat.next()) {
        categoryId = cat.getUniqueValue();
        gs.info('Category exists: ' + CATEGORY.title);
    } else {
        cat.initialize();
        cat.setValue('title', CATEGORY.title);
        cat.setValue('order', CATEGORY.order);
        cat.setValue('configuration', CONFIG_ID);  // CRITICAL: links to workspace menu config
        cat.sys_scope = SCOPE_ID;
        cat.sys_package = SCOPE_ID;
        categoryId = cat.insert();
        gs.info('Created category: ' + CATEGORY.title + ' (' + categoryId + ')');
    }
} else {
    categoryId = EXISTING_CATEGORY_ID;
    gs.info('Using existing category: ' + categoryId);
}

// ============================================================
// STEP 2: APPLICABILITY
// ============================================================

var applicabilityId = getOrCreateApplicability(APPLICABILITY);

// ============================================================
// STEP 3: LISTS + M2M + TRANSLATIONS
// ============================================================

var created = 0;
var skipped = 0;

for (var i = 0; i < LISTS.length; i++) {
    var listConfig = LISTS[i];

    // Check if list exists
    var existing = new GlideRecord('sys_ux_list');
    existing.addQuery('title', listConfig.title);
    existing.addQuery('table', listConfig.table);
    existing.query();

    if (existing.hasNext()) {
        gs.info('List already exists: ' + listConfig.title);
        skipped++;
        continue;
    }

    // Create list
    var list = new GlideRecord('sys_ux_list');
    list.initialize();
    list.setValue('title', listConfig.title);
    list.setValue('table', listConfig.table);
    list.setValue('configuration', CONFIG_ID);  // CRITICAL: links to workspace menu config
    list.setValue('category', categoryId);      // CRITICAL: links to sidebar group
    list.setValue('filter', listConfig.filter);
    list.setValue('columns', listConfig.columns);
    if (listConfig.orderBy) list.setValue('order_by', listConfig.orderBy);
    list.sys_scope = SCOPE_ID;
    list.sys_package = SCOPE_ID;
    var listId = list.insert();
    gs.info('Created list: ' + listConfig.title + ' (' + listId + ')');

    // M2M: Link applicability (controls role-based visibility)
    // Note: category is set directly on the list record, no separate M2M needed
    var m2mApp = new GlideRecord('sys_ux_applicability_m2m_list');
    m2mApp.initialize();
    m2mApp.setValue('list', listId);
    m2mApp.setValue('applicability', applicabilityId);
    m2mApp.sys_scope = SCOPE_ID;
    m2mApp.insert();

    // Translations
    createTranslation('sys_ux_list', 'title', listId, SOURCE_LANG, listConfig.title);
    if (TARGET_LANG && listConfig.title_translated) {
        createTranslation('sys_ux_list', 'title', listId, TARGET_LANG, listConfig.title_translated);
    }

    created++;
}

gs.info('============================================================');
gs.info('WORKSPACE LIST CREATION COMPLETE');
gs.info('Created: ' + created + ' | Skipped: ' + skipped);
gs.info('============================================================');
