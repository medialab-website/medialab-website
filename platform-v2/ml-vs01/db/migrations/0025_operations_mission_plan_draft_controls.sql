-- P02-M19-A adds staff-only, permission-checked read projections.
-- It exposes no protected envelope bytes and adds no canonical storage or mutation law.

CREATE OR REPLACE FUNCTION medialab_core.get_operations_mission_plan_draft_controls(
    p_session_token text,
    p_mission_plan_id uuid
)
RETURNS jsonb AS $$
DECLARE
    v_actor uuid;
    v_plan medialab_core.mission_plans%ROWTYPE;
    v_draft medialab_core.mission_plan_drafts%ROWTYPE;
    v_result jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT * INTO v_plan FROM medialab_core.mission_plans WHERE id = p_mission_plan_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Mission Plan not found' USING ERRCODE = '22023'; END IF;
    PERFORM medialab_core.require_mission_plan_permission(v_actor, v_plan.organization_id, 'mission_plan.manage');
    SELECT * INTO v_draft FROM medialab_core.mission_plan_drafts WHERE mission_plan_id = v_plan.id;

    SELECT jsonb_build_object(
      'missionPlanId', v_plan.id,
      'stale', v_draft.source_fingerprint_sha256 <> medialab_core.compute_mission_plan_source_fingerprint(v_plan.id),
      'eligibleWorkstreams', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'workstreamId', sw.id, 'displayName', sw.frozen_source_description, 'state', sw.current_state,
          'selected', EXISTS (SELECT 1 FROM medialab_core.mission_plan_draft_workstreams selected
            WHERE selected.mission_plan_id = v_plan.id AND selected.service_workstream_id = sw.id)
        ) ORDER BY sw.created_at, sw.id)
        FROM medialab_core.service_workstreams sw
        WHERE sw.job_id = v_plan.job_id AND sw.organization_id = v_plan.organization_id
          AND sw.current_state NOT IN ('COMPLETED', 'CANCELLED')
      ), '[]'::jsonb),
      'eligibleContacts', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'personId', cm.person_id, 'contactMethodId', cm.id, 'displayName', op.frozen_display_name,
          'contactType', cm.contact_type, 'displayValue', cm.normalized_value, 'contactRole', 'CUSTOMER',
          'selected', EXISTS (SELECT 1 FROM medialab_core.mission_plan_draft_contacts selected
            WHERE selected.mission_plan_id = v_plan.id AND selected.contact_method_id = cm.id
              AND selected.contact_role = 'CUSTOMER'),
          'visibility', COALESCE((SELECT selected.visibility_classification
            FROM medialab_core.mission_plan_draft_contacts selected
            WHERE selected.mission_plan_id = v_plan.id AND selected.contact_method_id = cm.id
              AND selected.contact_role = 'CUSTOMER'), 'ASSIGNED_CREW_ONLY')
        ) ORDER BY cm.contact_type, cm.id)
        FROM medialab_core.order_parties op
        JOIN medialab_core.contact_methods cm ON cm.person_id = op.person_id AND cm.lifecycle_state = 'ACTIVE'
        WHERE op.order_id = v_plan.order_id AND op.party_role = 'CUSTOMER'
      ), '[]'::jsonb),
      'notes', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'noteId', n.id, 'visibility', n.visibility_classification, 'text', n.note_text, 'authoredAt', n.authored_at
        ) ORDER BY n.authored_at, n.id)
        FROM medialab_core.mission_plan_notes n WHERE n.mission_plan_id = v_plan.id
      ), '[]'::jsonb)
    ) INTO v_result;
    RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

REVOKE ALL ON FUNCTION medialab_core.get_operations_mission_plan_draft_controls(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION medialab_core.get_operations_order_customer_contacts(
    p_session_token text,
    p_order_id uuid
)
RETURNS jsonb AS $$
DECLARE v_actor uuid; v_organization_id uuid; v_result jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor FROM medialab_core.resolve_ordinary_session(p_session_token);
    SELECT organization_id INTO v_organization_id FROM medialab_core.orders WHERE id = p_order_id;
    IF v_organization_id IS NULL THEN RAISE EXCEPTION 'Order not found' USING ERRCODE = '22023'; END IF;
    PERFORM medialab_core.require_order_permission(v_actor, v_organization_id, 'order.read');
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'contactType', cm.contact_type, 'displayValue', cm.normalized_value
    ) ORDER BY cm.contact_type, cm.id), '[]'::jsonb) INTO v_result
      FROM medialab_core.order_parties op
      JOIN medialab_core.contact_methods cm ON cm.person_id = op.person_id AND cm.lifecycle_state = 'ACTIVE'
     WHERE op.order_id = p_order_id AND op.party_role = 'CUSTOMER';
    RETURN v_result;
END;
$$ LANGUAGE plpgsql STRICT STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

REVOKE ALL ON FUNCTION medialab_core.get_operations_order_customer_contacts(text, uuid) FROM PUBLIC;
