// ============================================================
// EXAMPLE: Case Triage State Validation Business Rule
// ============================================================
// Didactic example (table x_acme_fm_case, example state values) showing
// proper separation of filter_condition and script logic.
//
// filter_condition: state=6^ORstateCHANGESFROM0^EQ
// action_update: true
// when: before
// ============================================================

// The filter_condition determines WHEN the BR runs:
// - state=6 (record sits in "Rejected" status), OR
// - stateCHANGESFROM0 (state is moving away from "Awaiting triage")

// The script ONLY differentiates between these two scenarios.
// It does NOT re-check what the filter already guarantees.

(function executeRule(current, previous) {

    // ============================================================
    // SCENARIO A: Update while "Rejected" (state=6)
    // Filter guarantees: state=6
    // Additional check: did the case type change?
    // Business rule: changing the type of a rejected case sends it
    // back to triage with the type cleared for re-classification.
    // ============================================================
    if (current.state == 6 && current.u_case_type.changes()) {
        current.u_case_type = '';
        current.state = 0;
        gs.addInfoMessage(gs.getMessage('acme.case_triage.status_reset_to_triage')); // example key namespace
        return;
    }

    // ============================================================
    // SCENARIO B: Leaving "Awaiting triage" (stateCHANGESFROM0)
    // Filter guarantees: state changed FROM 0
    // No need to check: if (previous.state == 0) — the filter handles this!
    // ============================================================
    else {
        // A case type is required before triage can complete
        if (current.u_case_type.nil()) {
            gs.addErrorMessage(gs.getMessage('acme.case_triage.type_required'));
            current.setAbortAction(true);
            return;
        }

        var caseType = current.getValue('u_case_type');
        var newState = current.getValue('state');

        // General inquiries are out of scope -> only allowed to "Rejected" (6)
        if (caseType == 'general_inquiry' && newState != 6) {
            gs.addErrorMessage(gs.getMessage('acme.case_triage.inquiry_only_rejected'));
            current.setAbortAction(true);
            return;
        }

        // All other types enter the process -> only allowed to "Open" (1)
        if (caseType != 'general_inquiry' && newState != 1) {
            gs.addErrorMessage(gs.getMessage('acme.case_triage.other_types_only_open'));
            current.setAbortAction(true);
            return;
        }
    }

})(current, previous);


// ============================================================
// KEY LESSON: Trust the filter_condition!
// ============================================================
//
// BAD (duplicate check):
//   if (previous && previous.state == 0 && current.state != 0) { ... }
//
// GOOD (trust filter):
//   else { ... }  // Filter guarantees stateCHANGESFROM0
//
// The filter_condition is the gatekeeper.
// The script only differentiates between the allowed scenarios.
// ============================================================
