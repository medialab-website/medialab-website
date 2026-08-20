-- P02-M18-A adds provider-neutral, permission-checked entry projections only.
-- Canonical scheduling, appointment, job, and assignment mutations remain owned
-- by the accepted 0007-0009 command functions.

CREATE OR REPLACE FUNCTION medialab_core.operations_order_context(
    p_actor_identity_id uuid,
    p_order_id uuid
)
RETURNS jsonb AS $$
DECLARE
    v_order medialab_core.orders%ROWTYPE;
    v_request medialab_core.scheduling_requests%ROWTYPE;
    v_appointment medialab_core.appointments%ROWTYPE;
    v_job medialab_core.jobs%ROWTYPE;
    v_result jsonb;
    v_attention jsonb := '[]'::jsonb;
BEGIN
    SELECT * INTO v_order FROM medialab_core.orders WHERE id = p_order_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order is missing or unavailable' USING ERRCODE = '42501';
    END IF;
    PERFORM medialab_core.require_order_permission(p_actor_identity_id, v_order.organization_id, 'order.read');

    IF (SELECT count(*) FROM medialab_core.property_hub_orders WHERE order_id = v_order.id) > 1
      OR ((SELECT count(*) FROM medialab_core.scheduling_requests r
            WHERE r.order_id = v_order.id
              AND medialab_core.current_scheduling_request_state(r.id) = 'REQUESTED'
              AND NOT EXISTS (SELECT 1 FROM medialab_core.appointments ap WHERE ap.scheduling_request_id = r.id))
        + (SELECT count(*) FROM medialab_core.appointments ap
            WHERE ap.order_id = v_order.id
              AND medialab_core.current_appointment_state(ap.id) IN ('CONFIRMED', 'WEATHER_DELAYED'))) > 1
      OR (SELECT count(*) FROM medialab_core.jobs j
           WHERE j.order_id = v_order.id AND j.current_state NOT IN ('COMPLETED', 'CANCELLED')) > 1 THEN
        RAISE EXCEPTION 'Operational context is ambiguous' USING ERRCODE = '23514';
    END IF;

    SELECT * INTO v_request
      FROM medialab_core.scheduling_requests
     WHERE order_id = v_order.id
     ORDER BY (medialab_core.current_scheduling_request_state(id) = 'REQUESTED'
               AND NOT EXISTS (SELECT 1 FROM medialab_core.appointments ap WHERE ap.scheduling_request_id = scheduling_requests.id)) DESC,
              created_at DESC, id DESC LIMIT 1;
    IF FOUND THEN
        IF (SELECT count(*) FROM medialab_core.appointments WHERE scheduling_request_id = v_request.id) > 1 THEN
            RAISE EXCEPTION 'Operational Appointment context is ambiguous' USING ERRCODE = '23514';
        END IF;
        SELECT * INTO v_appointment
          FROM medialab_core.appointments
         WHERE scheduling_request_id = v_request.id
         ORDER BY confirmed_at DESC, id DESC LIMIT 1;
    END IF;
    SELECT * INTO v_job
      FROM medialab_core.jobs
     WHERE order_id = v_order.id
     ORDER BY (current_state NOT IN ('COMPLETED', 'CANCELLED')) DESC, created_at DESC, id DESC LIMIT 1;

    IF NOT EXISTS (SELECT 1 FROM medialab_core.property_hub_orders WHERE order_id = v_order.id) THEN
        v_attention := v_attention || '"OPERATIONAL_CONTEXT_NOT_STARTED"'::jsonb;
    END IF;
    IF v_request.id IS NULL OR NOT EXISTS (
        SELECT 1 FROM medialab_core.scheduling_windows WHERE scheduling_request_id = v_request.id
    ) THEN v_attention := v_attention || '"SCHEDULING_WINDOW_NEEDED"'::jsonb; END IF;
    IF v_appointment.id IS NULL THEN
        v_attention := v_attention || '"APPOINTMENT_NOT_CONFIRMED"'::jsonb;
    ELSIF medialab_core.current_appointment_state(v_appointment.id) IN ('CONFIRMED', 'WEATHER_DELAYED')
      AND NOT EXISTS (
        SELECT 1 FROM medialab_core.appointment_participant_assignments a
         WHERE a.appointment_id = v_appointment.id
           AND a.operational_role = 'PRIMARY_OPERATOR'
           AND NOT EXISTS (
             SELECT 1 FROM medialab_core.appointment_participant_assignment_endings e
              WHERE e.assignment_id = a.id
           )
      ) THEN v_attention := v_attention || '"PRIMARY_OPERATOR_UNASSIGNED"'::jsonb; END IF;
    IF v_job.current_state = 'BLOCKED' THEN v_attention := v_attention || '"JOB_BLOCKED"'::jsonb; END IF;
    IF EXISTS (
        SELECT 1 FROM medialab_core.service_workstreams
         WHERE job_id = v_job.id AND current_state = 'BLOCKED'
    ) THEN v_attention := v_attention || '"WORKSTREAM_BLOCKED"'::jsonb; END IF;

    SELECT jsonb_build_object(
      'orderId', o.id,
      'organizationId', o.organization_id,
      'orderStatus', o.current_state,
      'createdAt', o.created_at,
      'customer', COALESCE((
        SELECT jsonb_build_object('personId', p.person_id, 'displayName', p.frozen_display_name, 'email', pe.email)
          FROM medialab_core.order_parties p
          LEFT JOIN medialab_core.people pe ON pe.id = p.person_id
         WHERE p.order_id = o.id AND p.party_role = 'CUSTOMER' LIMIT 1
      ), '{}'::jsonb),
      'property', jsonb_build_object(
        'propertyId', o.property_id, 'propertySnapshotId', o.property_snapshot_id,
        'addressLine1', ps.address_line_1, 'addressLine2', ps.address_line_2,
        'locality', ps.locality, 'administrativeArea', ps.administrative_area,
        'postalCode', ps.postal_code, 'countryCode', ps.country_code,
        'squareFeet', ps.reported_square_feet
      ),
      'services', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'orderItemId', i.id, 'position', i.position, 'displayName', i.frozen_description,
          'quantity', i.quantity, 'commercialUnit', i.commercial_unit
        ) ORDER BY i.position) FROM medialab_core.order_items i WHERE i.order_id = o.id
      ), '[]'::jsonb),
      'propertyHubId', (
        SELECT h.property_hub_id FROM medialab_core.property_hub_orders h
         WHERE h.order_id = o.id ORDER BY h.associated_at DESC LIMIT 1
      ),
      'schedulingRequestLineageIds', COALESCE((
        SELECT jsonb_agg(r.id ORDER BY r.created_at, r.id)
          FROM medialab_core.scheduling_requests r WHERE r.order_id = o.id
      ), '[]'::jsonb),
      'appointmentLineageIds', COALESCE((
        SELECT jsonb_agg(ap.id ORDER BY ap.confirmed_at, ap.id)
          FROM medialab_core.appointments ap WHERE ap.order_id = o.id
      ), '[]'::jsonb),
      'assignmentLineageIds', CASE WHEN v_appointment.id IS NULL THEN '[]'::jsonb ELSE COALESCE((
        SELECT jsonb_agg(a.id ORDER BY a.assigned_at, a.id)
          FROM medialab_core.appointment_participant_assignments a
         WHERE a.appointment_id = v_appointment.id
      ), '[]'::jsonb) END,
      'scheduling', CASE WHEN v_request.id IS NULL THEN NULL ELSE jsonb_build_object(
        'requestId', v_request.id,
        'customerIdentityId', v_request.customer_identity_id,
        'state', CASE WHEN v_appointment.id IS NOT NULL THEN 'FULFILLED'
                      ELSE medialab_core.current_scheduling_request_state(v_request.id) END,
        'creationMode', v_request.creation_mode,
        'createdAt', v_request.created_at,
        'windows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'windowId', w.id, 'kind', w.window_kind, 'startsAt', w.starts_at,
          'endsAt', w.ends_at, 'ianaTimezone', w.iana_timezone,
          'localStartsAt', w.local_starts_at, 'localEndsAt', w.local_ends_at,
          'accepted', EXISTS (
            SELECT 1 FROM medialab_core.scheduling_acceptances a
             WHERE a.proposal_window_id = w.id
          )
        ) ORDER BY w.recorded_at, w.id) FROM medialab_core.scheduling_windows w
          WHERE w.scheduling_request_id = v_request.id), '[]'::jsonb)
      ) END,
      'appointment', CASE WHEN v_appointment.id IS NULL THEN NULL ELSE jsonb_build_object(
        'appointmentId', v_appointment.id,
        'state', medialab_core.current_appointment_state(v_appointment.id),
        'startsAt', v_appointment.starts_at, 'endsAt', v_appointment.ends_at,
        'ianaTimezone', v_appointment.iana_timezone,
        'localStartsAt', v_appointment.local_starts_at, 'localEndsAt', v_appointment.local_ends_at,
        'assignments', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'assignmentId', a.id, 'personId', a.person_id, 'displayName', p.display_name,
          'operationalRole', a.operational_role, 'assignedAt', a.assigned_at
        ) ORDER BY a.assigned_at, a.id) FROM medialab_core.appointment_participant_assignments a
          JOIN medialab_core.people p ON p.id = a.person_id
         WHERE a.appointment_id = v_appointment.id AND NOT EXISTS (
           SELECT 1 FROM medialab_core.appointment_participant_assignment_endings e WHERE e.assignment_id = a.id
         )), '[]'::jsonb)
      ) END,
      'job', CASE WHEN v_job.id IS NULL THEN NULL ELSE jsonb_build_object(
        'jobId', v_job.id, 'state', v_job.current_state,
        'workstreams', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'workstreamId', w.id, 'sourceOrderItemId', w.source_order_item_id,
          'displayName', w.frozen_source_description, 'state', w.current_state
        ) ORDER BY w.created_at, w.id) FROM medialab_core.service_workstreams w
          WHERE w.job_id = v_job.id), '[]'::jsonb)
      ) END,
      'attention', v_attention
    ) INTO v_result
      FROM medialab_core.orders o
      JOIN medialab_core.property_snapshots ps ON ps.id = o.property_snapshot_id
     WHERE o.id = v_order.id;
    RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.get_operations_order_context(
    p_session_token text,
    p_order_id uuid
)
RETURNS jsonb AS $$
DECLARE v_actor_identity_id uuid;
BEGIN
    SELECT actor_identity_id INTO v_actor_identity_id
      FROM medialab_core.resolve_ordinary_session(p_session_token);
    RETURN medialab_core.operations_order_context(v_actor_identity_id, p_order_id);
END;
$$ LANGUAGE plpgsql STRICT STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.get_operations_home(
    p_session_token text,
    p_from timestamptz,
    p_to timestamptz
)
RETURNS jsonb AS $$
DECLARE v_actor_identity_id uuid; v_actor_person_id uuid; v_result jsonb;
BEGIN
    IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from OR p_to > p_from + interval '120 days' THEN
      RAISE EXCEPTION 'Operations Home range is invalid' USING ERRCODE = '22023';
    END IF;
    SELECT actor_identity_id, actor_person_id INTO v_actor_identity_id, v_actor_person_id
      FROM medialab_core.resolve_ordinary_session(p_session_token);
    WITH candidates AS (
      SELECT o.id, COALESCE(a.starts_at, o.created_at) AS sort_at, a.starts_at AS appointment_start,
             medialab_core.operations_order_context(v_actor_identity_id, o.id) AS context
        FROM medialab_core.orders o
        LEFT JOIN LATERAL (
          SELECT ap.starts_at FROM medialab_core.appointments ap
           WHERE ap.order_id = o.id ORDER BY ap.confirmed_at DESC, ap.id DESC LIMIT 1
        ) a ON true
       WHERE EXISTS (
         SELECT 1 FROM medialab_core.memberships m
          WHERE m.organization_id = o.organization_id AND m.person_id = v_actor_person_id
            AND m.status = 'ACTIVE'
       )
         AND medialab_core.actor_has_permission(v_actor_identity_id, o.organization_id, 'order.read')
         AND (a.starts_at IS NULL OR (a.starts_at >= p_from AND a.starts_at < p_to))
    )
    SELECT jsonb_build_object(
      'generatedAt', clock_timestamp(), 'rangeStartsAt', p_from, 'rangeEndsAt', p_to,
      'items', COALESCE(jsonb_agg(context ORDER BY sort_at, id), '[]'::jsonb),
      'sections', jsonb_build_object(
        'today', COALESCE(jsonb_agg(context ORDER BY sort_at, id) FILTER (
          WHERE appointment_start >= p_from AND appointment_start < p_from + interval '1 day'
        ), '[]'::jsonb),
        'upcoming', COALESCE(jsonb_agg(context ORDER BY sort_at, id) FILTER (
          WHERE appointment_start IS NULL OR appointment_start >= p_from + interval '1 day'
        ), '[]'::jsonb),
        'needsAttention', COALESCE(jsonb_agg(context ORDER BY sort_at, id) FILTER (
          WHERE jsonb_array_length(context->'attention') > 0
        ), '[]'::jsonb)
      ),
      'counts', jsonb_build_object(
        'today', count(*) FILTER (
          WHERE appointment_start >= p_from AND appointment_start < p_from + interval '1 day'
        ),
        'upcoming', count(*) FILTER (
          WHERE appointment_start IS NULL OR appointment_start >= p_from + interval '1 day'
        ),
        'needsAttention', count(*) FILTER (
          WHERE jsonb_array_length(context->'attention') > 0
        )
      )
    ) INTO v_result FROM candidates;
    RETURN v_result;
END;
$$ LANGUAGE plpgsql STRICT STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

CREATE OR REPLACE FUNCTION medialab_core.list_operations_assignment_candidates(
    p_session_token text,
    p_organization_id uuid
)
RETURNS jsonb AS $$
DECLARE v_actor_identity_id uuid; v_result jsonb;
BEGIN
    SELECT actor_identity_id INTO v_actor_identity_id
      FROM medialab_core.resolve_ordinary_session(p_session_token);
    PERFORM medialab_core.require_scheduling_staff(v_actor_identity_id, p_organization_id);
    SELECT jsonb_build_object('organizationId', p_organization_id, 'candidates', COALESCE(jsonb_agg(
      jsonb_build_object('personId', p.id, 'displayName', p.display_name, 'title', p.title)
      ORDER BY p.display_name, p.id), '[]'::jsonb)) INTO v_result
      FROM medialab_core.memberships m JOIN medialab_core.people p ON p.id = m.person_id
     WHERE m.organization_id = p_organization_id AND m.status = 'ACTIVE'
       AND EXISTS (
         SELECT 1 FROM medialab_core.identities i
         JOIN medialab_core.person_account_states s
           ON s.identity_id = i.id AND s.person_id = i.person_id
        WHERE i.person_id = p.id AND i.status = 'ACTIVE'
          AND s.current_state IN ('ACTIVE', 'RECOVERED')
       );
    RETURN v_result;
END;
$$ LANGUAGE plpgsql STRICT STABLE SECURITY DEFINER
SET search_path = pg_catalog, medialab_core, pg_temp;

REVOKE ALL ON FUNCTION medialab_core.operations_order_context(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.get_operations_order_context(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.get_operations_home(text, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION medialab_core.list_operations_assignment_candidates(text, uuid) FROM PUBLIC;
