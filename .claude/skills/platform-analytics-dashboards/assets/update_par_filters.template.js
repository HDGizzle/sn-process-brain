// TEMPLATE: in-place update of an existing par_ dashboard's tiles/list WITHOUT recreating it.
// Use this once the dashboard is live/embedded so you don't break its sys_id, workspace page, or visibility.
// Create as a SCOPED fix script in the dashboard's scope (no setApplicationId needed).
// Reuse ssProps()/listProps() from build_par_dashboard.template.js.
(function () {
  try {
    var DASH = '<DASHBOARD_SYS_ID>';
    // var ssProps = ..., listProps = ...   // copy from build template (with b64/uid helpers)

    // Map widget/visualization NAME -> new properties JSON string.
    // Commented lines below are EXAMPLES — replace tables, queries, names, and the
    // "One of My Groups" dynamic-filter sys_id with your instance's values.
    var spec = {};
    // spec['To classify'] = ssProps('x_acme_fm_case', 'sys_class_nameINx_acme_fm_case,x_acme_fm_request^state=1^assignment_groupDYNAMIC<ONE_OF_MY_GROUPS_SYS_ID>', 'To classify');
    // spec['My actions']  = ssProps('x_acme_fm_action', 'assigned_to=javascript:gs.getUserID()^stateIN1,2,6', 'My actions');
    // spec['... list ...'] = listProps('x_acme_fm_case', '...^active=true^...^ORDERBYdue_date', '...', 'number,short_description,sys_class_name,...');

    var updated = {}; // widgetSysId -> newProps
    var vizCount = 0, widgetCount = 0;

    var canv = new GlideRecord('par_dashboard_canvas');
    canv.addQuery('dashboard', DASH);
    canv.query();
    while (canv.next()) {
      var canvasId = canv.getUniqueValue();
      var origLayout = canv.getValue('layout');

      var w = new GlideRecord('par_dashboard_widget');
      w.addQuery('canvas', canvasId);
      w.query();
      while (w.next()) {
        var nm = w.getValue('name');
        if (spec.hasOwnProperty(nm)) {
          var np = spec[nm];
          w.setValue('component_props', np); w.update();
          updated[w.getUniqueValue()] = np; widgetCount++;
          var vizId = w.getValue('stored_component') || w.getValue('visualization');
          if (vizId) { var vz = new GlideRecord('par_visualization'); if (vz.get(vizId)) { vz.setValue('properties', np); vz.update(); vizCount++; } }
        }
      }

      if (origLayout) {
        try {
          var arr = JSON.parse(origLayout), changed = false;
          for (var i = 0; i < arr.length; i++) {
            if (arr[i] && updated.hasOwnProperty(arr[i].sys_id)) { arr[i].component_props = updated[arr[i].sys_id]; changed = true; }
          }
          if (changed) { var cu = new GlideRecord('par_dashboard_canvas'); if (cu.get(canvasId)) { cu.setValue('layout', JSON.stringify(arr)); cu.update(); } }
        } catch (eL) { gs.error('par update: layout parse failed on ' + canvasId + ' :: ' + eL); }
      }
    }
    gs.info('par update: done. visualizations=' + vizCount + ', widgets=' + widgetCount);
  } catch (e) { gs.error('par update FATAL: ' + e + ' :: ' + (e.stack || 'no-stack')); }
})();
