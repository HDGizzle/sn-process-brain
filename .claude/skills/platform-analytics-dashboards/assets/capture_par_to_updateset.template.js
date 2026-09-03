// TEMPLATE: force-capture a scripted par_ dashboard into a specific update set.
// Run as a GLOBAL fix script (GlideUpdateSet is a global API; global has cross-scope write to par_*).
// Why: GlideRecord writes to par_* from a fix script do NOT auto-record to an update set
// (verify on your instance first).
(function () {
  try {
    var UPDATE_SET = '<UPDATE_SET_SYS_ID>';
    var DASH = '<DASHBOARD_SYS_ID>';

    var us = new GlideUpdateSet();
    var prev = us.set(UPDATE_SET);

    var n = 0;
    function cap(table, sysId) {
      if (!sysId) return;
      var gr = new GlideRecord(table);
      if (gr.get(sysId)) { gr.setForceUpdate(true); gr.update(); n++; }
    }

    cap('par_dashboard', DASH);
    var t = new GlideRecord('par_dashboard_tab'); t.addQuery('dashboard', DASH); t.query();
    while (t.next()) cap('par_dashboard_tab', t.getUniqueValue());
    var c = new GlideRecord('par_dashboard_canvas'); c.addQuery('dashboard', DASH); c.query();
    while (c.next()) {
      cap('par_dashboard_canvas', c.getUniqueValue());
      var w = new GlideRecord('par_dashboard_widget'); w.addQuery('canvas', c.getUniqueValue()); w.query();
      while (w.next()) {
        cap('par_dashboard_widget', w.getUniqueValue());
        cap('par_visualization', w.getValue('stored_component') || w.getValue('visualization'));
      }
    }
    var v = new GlideRecord('par_dashboard_visibility'); v.addQuery('dashboard', DASH); v.query();
    while (v.next()) cap('par_dashboard_visibility', v.getUniqueValue());

    if (prev) us.set(prev);
    gs.info('par capture: forced ' + n + ' records into update set ' + UPDATE_SET);
  } catch (e) { gs.error('par capture FATAL: ' + e + ' :: ' + (e.stack || 'no-stack')); }
})();
