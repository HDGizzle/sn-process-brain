// TEMPLATE: build a Platform Analytics (par_) dashboard + visualizations from scratch.
// Run as a fix script. SCOPED variant: remove the setApplicationId line (runs in-scope).
// GLOBAL variant: keep setApplicationId so records land in the target scope.
// Idempotent: deletes a prior same-named dashboard + viz before building, so re-runs are safe.
// All names/tables below are EXAMPLES — replace with your project's values.
(function () {
  try {
    var SCOPE = '<TARGET_SCOPE_SYS_ID>';
    var SS_MACRO = 'd24d53f60350de7a652caf3188a46ed2';   // Single score (OOTB — verify on your instance)
    var LIST_MACRO = '7ff373544303121093711347efb8f23c'; // List (OOTB — verify on your instance)
    var GRID = '48';
    var DASH_NAME = 'Operations Overview'; // example dashboard name

    gs.getSession().setApplicationId(SCOPE); // GLOBAL variant only; delete for a scoped fix script

    // ---- idempotent cleanup ------------------------------------------------
    (function cleanup() {
      // Example viz names — list every visualization name this script creates,
      // so re-runs delete the previous generation first.
      var names = ['To classify', 'My actions', 'Investigations', 'To verify',
        'Open cases [my groups]'];
      var dbo = new GlideRecord('par_dashboard');
      dbo.addQuery('name', DASH_NAME); dbo.addQuery('sys_scope', SCOPE); dbo.query();
      while (dbo.next()) {
        var did = dbo.getUniqueValue();
        var cv = new GlideRecord('par_dashboard_canvas'); cv.addQuery('dashboard', did); cv.query();
        while (cv.next()) { var wd = new GlideRecord('par_dashboard_widget'); wd.addQuery('canvas', cv.getUniqueValue()); wd.deleteMultiple(); }
        var cv2 = new GlideRecord('par_dashboard_canvas'); cv2.addQuery('dashboard', did); cv2.deleteMultiple();
        var tb = new GlideRecord('par_dashboard_tab'); tb.addQuery('dashboard', did); tb.deleteMultiple();
        dbo.deleteRecord();
      }
      var vz = new GlideRecord('par_visualization'); vz.addQuery('sys_scope', SCOPE); vz.addQuery('name', 'IN', names.join(',')); vz.deleteMultiple();
    })();

    var seq = 0;
    function uid() { seq++; return '' + new GlideDateTime().getNumericValue() + seq + Math.floor(Math.random() * 1000000); }
    function b64(s) { return GlideStringUtil.base64Encode(s); }

    function ssProps(table, filter, title) {
      var dsId = b64('table' + table + uid()); var metricId = b64(dsId + uid());
      return JSON.stringify({
        scoreSize: "auto", headingPosition: "top", showZero: true, configVersion: "23.0.0-ci-SNAPSHOT",
        colorConfig: { type: "default" }, enableDrilldown: true, emptyStateAlignment: "vertical-centered",
        dataSources: [{ isDatabaseView: false, allowRealTime: true, sourceType: "table", tableOrViewName: table, filterQuery: filter, preferredVisualizations: [SS_MACRO], id: dsId, dataCategories: ["trend", "group", "simple"] }],
        metrics: [{ dataSource: dsId, id: metricId, aggregateFunction: "COUNT", axisId: "primary", label: title, numberFormat: { customFormat: false } }],
        headerTitle: title, showHeader: true, showBorder: true
      });
    }
    function listProps(table, filter, title, columns) {
      var dsId = b64('table' + table + uid()); var metricId = b64(dsId + uid());
      return JSON.stringify({
        metrics: [{ aggregateFunction: "COUNT", axisId: "primary", dataSource: dsId, id: metricId, numberFormat: { customFormat: true, abbreviationEnabled: true, numberInTooltipsEnabled: true } }],
        table: table, columns: columns,
        dataSources: [{ allowRealTime: true, dataCategories: ["trend", "group", "simple"], filterQuery: filter, id: dsId, isDatabaseView: false, sourceType: "table", tableOrViewName: table }],
        enableDrilldown: true, filterConfigurations: "@state.parFilters", limit: 50, showColumnSorting: true,
        showHeader: true, headerTitle: title, showLinks: true, showViewAll: true, allowListPagination: true,
        preferredVisualizations: [SS_MACRO], showBorder: true
      });
    }
    function createViz(name, type, macro, props) {
      var gr = new GlideRecord('par_visualization');
      gr.setValue('name', name); gr.setValue('title', name); gr.setValue('type', type);
      gr.setValue('macroponent', macro); gr.setValue('properties', props); gr.setValue('active', true);
      gr.setValue('sys_scope', SCOPE); return gr.insert();
    }

    // 1. visualizations (edit table/filter/columns to taste) -----------------
    var viz = [/* { key, name, type, macro, props: ssProps(...) | listProps(...) } */];
    var vizId = {};
    for (var i = 0; i < viz.length; i++) { vizId[viz[i].key] = createViz(viz[i].name, viz[i].type, viz[i].macro, viz[i].props); }

    // 2. dashboard -----------------------------------------------------------
    var db = new GlideRecord('par_dashboard');
    db.setValue('name', DASH_NAME); db.setValue('active', true); db.setValue('grid', GRID); db.setValue('sys_scope', SCOPE);
    var dashId = db.insert();

    // 3. tabs (reuse auto-created "New Tab 1" as the first tab) ---------------
    var tabNames = ['Overview']; // example tab name
    var tabId = {};
    var ex = new GlideRecord('par_dashboard_tab'); ex.addQuery('dashboard', dashId); ex.orderBy('order'); ex.query();
    var autoTab = ex.next() ? ex.getUniqueValue() : null;
    for (var t = 0; t < tabNames.length; t++) {
      var gt;
      if (t === 0 && autoTab) { gt = new GlideRecord('par_dashboard_tab'); gt.get(autoTab); gt.setValue('name', tabNames[t]); gt.setValue('order', t); gt.setValue('active', true); gt.update(); tabId[t] = autoTab; }
      else { gt = new GlideRecord('par_dashboard_tab'); gt.setValue('dashboard', dashId); gt.setValue('name', tabNames[t]); gt.setValue('order', t); gt.setValue('active', true); gt.setValue('sys_scope', SCOPE); tabId[t] = gt.insert(); }
    }

    // 4. canvas per tab (reuse auto-created if present) -----------------------
    function getOrCreateCanvas(tab) {
      var c = new GlideRecord('par_dashboard_canvas'); c.addQuery('dashboard_tab', tab); c.query();
      if (c.next()) return c.getUniqueValue();
      var nc = new GlideRecord('par_dashboard_canvas'); nc.setValue('dashboard', dashId); nc.setValue('dashboard_tab', tab); nc.setValue('layout', '[]'); nc.setValue('sys_scope', SCOPE); return nc.insert();
    }
    var canvasId = {}; for (var c2 = 0; c2 < tabNames.length; c2++) canvasId[c2] = getOrCreateCanvas(tabId[c2]);

    // 5. widgets on tab 0 + matching layout JSON (grid=48) -------------------
    var place = [/* { key, x, y, w, h } */];
    var vByKey = {}; for (var v = 0; v < viz.length; v++) vByKey[viz[v].key] = viz[v];
    var layout = [];
    for (var p = 0; p < place.length; p++) {
      var pl = place[p], vd = vByKey[pl.key];
      var w = new GlideRecord('par_dashboard_widget');
      w.setValue('canvas', canvasId[0]); w.setValue('visualization', vizId[pl.key]); w.setValue('stored_component', vizId[pl.key]);
      w.setValue('component', vd.macro); w.setValue('component_props', vd.props); w.setValue('name', vd.name);
      w.setValue('x', pl.x); w.setValue('y', pl.y); w.setValue('w', pl.w); w.setValue('h', pl.h); w.setValue('sys_scope', SCOPE);
      var wId = w.insert();
      layout.push({ sys_id: wId, x: pl.x, y: pl.y, w: pl.w, h: pl.h, component_id: vd.macro, component_props: vd.props, can_edit: true });
    }
    var oc = new GlideRecord('par_dashboard_canvas'); if (oc.get(canvasId[0])) { oc.setValue('layout', JSON.stringify(layout)); oc.update(); }

    // 6. visibility: add an experience (sys_ux_page_registry) per surface -----
    // var vis = new GlideRecord('par_dashboard_visibility');
    // vis.setValue('dashboard', dashId); vis.setValue('experience', '<EXPERIENCE_SYS_ID>'); vis.setValue('sys_scope', SCOPE); vis.insert();

    gs.info('par build complete. dashboard=' + dashId);
  } catch (e) { gs.error('par build FATAL: ' + e + ' :: ' + (e.stack || 'no-stack')); }
})();
