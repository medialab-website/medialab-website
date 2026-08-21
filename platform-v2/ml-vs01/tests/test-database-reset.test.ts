import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { resetTestDatabase } from '../db/reset-test-database.js';
import { EXPECTED_ROW_COUNTS } from '../db/fixtures/identity-tenancy-fixtures.js';
import { CATALOG_EXPECTED_ROW_COUNTS } from '../db/fixtures/current-catalog-price-fixtures.js';
import { CURRENT_REAL_ESTATE_EXPECTED_ROW_COUNTS } from '../db/fixtures/current-real-estate-catalog-seed.js';
import { ORDER_FOUNDATION_ROW_COUNT_INCREMENTS } from '../db/fixtures/order-foundation-fixtures.js';
import { PROPERTY_HUB_FOUNDATION_ROW_COUNT_INCREMENTS } from '../db/fixtures/property-hub-foundation-fixtures.js';
import { SCHEDULING_APPOINTMENT_FOUNDATION_ROW_COUNT_INCREMENTS } from '../db/fixtures/scheduling-appointment-foundation-fixtures.js';
import { JOB_SERVICE_WORKSTREAM_FOUNDATION_ROW_COUNT_INCREMENTS } from '../db/fixtures/job-service-workstream-foundation-fixtures.js';
import { MISSION_PLAN_FOUNDATION_ROW_COUNT_INCREMENTS } from '../db/fixtures/mission-plan-foundation-fixtures.js';
import { MEDIA_ASSET_FOUNDATION_ROW_COUNT_INCREMENTS } from '../db/fixtures/media-asset-identity-lineage-fixtures.js';
import { MEDIA_OPERATION_FOUNDATION_ROW_COUNT_INCREMENTS } from '../db/fixtures/durable-media-operations-reconciliation-fixtures.js';
import { MEDIA_CAPTURE_FOUNDATION_ROW_COUNT_INCREMENTS } from '../db/fixtures/capture-session-ingest-custody-fixtures.js';
import { MEDIA_CULL_FOUNDATION_ROW_COUNT_INCREMENTS } from '../db/fixtures/media-cull-workspace-selected-media-fixtures.js';
import { MEDIA_EDITOR_HANDOFF_FOUNDATION_ROW_COUNT_INCREMENTS } from '../db/fixtures/editor-handoff-returned-media-fixtures.js';
import { MEDIA_RETURN_REVIEW_FOUNDATION_ROW_COUNT_INCREMENTS } from '../db/fixtures/returned-editor-review-final-source-fixtures.js';
import { PUBLICATION_DELIVERY_FOUNDATION_ROW_COUNT_INCREMENTS } from '../db/fixtures/publication-delivery-entitlement-fixtures.js';
import { TEMPORARY_DOWNLOAD_CENTER_FOUNDATION_ROW_COUNT_INCREMENTS } from '../db/fixtures/temporary-download-center-external-sharing-fixtures.js';
import { EDITORIAL_SEGMENT_FOUNDATION_ROW_COUNT_INCREMENTS } from '../db/fixtures/editorial-segment-foundation-fixtures.js';

const TEST_DB = 'medialab_p02m16a_test';
const TEST_ROLE = 'medialab_p02m16a_test_owner';
const TEST_SOCKET = '/tmp/mlvs01-p02m16a-pg';
const TEST_PORT = 55447;

const EXACT_ROUTINE_NAMES = [
  'clear_editorial_segment_decision',
  'create_editorial_segment',
  'decide_editorial_segment',
  'get_editorial_segment',
  'list_editorial_segments',
  'record_media_technical_observation',
  'reject_editorial_evidence_mutation',
  'require_editorial_permission',
  'revise_editorial_segment',
  'validate_editorial_reason',
  'validate_editorial_safe_json',
  'validate_editorial_segment_scope',
  'classify_organization_record_order',
  'create_organization_record_export_snapshot',
  'get_internal_organization_records_projection',
  'get_organization_record_export_snapshot',
  'organization_record_projection_rows',
  'reject_organization_record_evidence_mutation',
  'revoke_personal_order_summary',
  'share_personal_order_summary',
  'validate_organization_record_text',
  'evaluate_temporary_download_center_gateway_access',
  'get_temporary_download_center_access_credential_history',
  'get_temporary_download_center_delivery_manifest',
  'resolve_temporary_download_center_delivery_source',
  'get_temporary_download_center_gateway_history',
  'guard_tdc_access_credential_current_mutation',
  'issue_temporary_download_center_access_credential',
  'reject_tdc_access_credential_evidence_mutation',
  'revoke_temporary_download_center_access_credential',
  'rotate_temporary_download_center_access_credential',
  'temporary_download_center_current_policy',
  'validate_tdc_access_credential_scope',
  'validate_temporary_download_center_gateway_json',
  'validate_temporary_download_center_gateway_text',
  'create_temporary_download_center',
  'evaluate_temporary_download_center_policy',
  'get_temporary_download_center',
  'get_temporary_download_center_activity',
  'materialize_temporary_download_center_version',
  'normalize_temporary_download_center_selections',
  'reject_temporary_download_center_evidence_mutation',
  'replace_temporary_download_center',
  'revoke_temporary_download_center',
  'temporary_download_center_hub_authority',
  'update_temporary_download_center_selection',
  'validate_temporary_download_center_json',
  'validate_temporary_download_center_text',
  'activate_media_publication',
  'add_media_publication_item',
  'create_media_publication',
  'delivery_subject_authority',
  'evaluate_delivery_entitlement',
  'evaluate_delivery_grant_access',
  'get_delivery_entitlement_history',
  'get_media_publication',
  'invalidate_publication_grants',
  'issue_delivery_grant',
  'record_delivery_financial_eligibility',
  'reject_publication_delivery_evidence_mutation',
  'require_publication_delivery_permission',
  'revoke_delivery_grant',
  'revoke_media_publication',
  'seal_media_publication',
  'validate_publication_delivery_json',
  'validate_publication_delivery_text',
  'admit_returned_review_item',
  'apply_returned_review_decision',
  'associate_quick_edit_corrected_version',
  'associate_returned_revision',
  'complete_returned_review_batch',
  'create_returned_review_batch',
  'current_returned_review_final_designation',
  'get_returned_review_batch',
  'get_returned_review_history',
  'get_returned_review_lineage',
  'link_returned_review_successor',
  'list_returned_review_batches',
  'record_returned_review_decision',
  'recompute_returned_review_current',
  'reject_returned_review_evidence_mutation',
  'require_returned_review_permission',
  'returned_review_final_purpose',
  'seal_returned_review_inventory',
  'supersede_returned_review_decision',
  'validate_returned_review_safe_json',
  'validate_returned_review_text',
  'complete_editor_handoff_returns', 'create_editor_handoff_batch', 'create_returned_media_intake_batch',
  'create_returned_version_for_match', 'get_editor_handoff_batch', 'get_returned_media_history',
  'list_editor_handoff_batches', 'record_editor_handoff_event', 'record_returned_media_item',
  'recompute_editor_handoff_current', 'reject_editor_handoff_evidence_mutation', 'require_editor_handoff_permission',
  'resolve_returned_media_match', 'validate_editor_handoff_reason', 'validate_editor_handoff_safe_json',
  'admit_cull_candidate', 'admit_cull_candidates', 'clear_cull_candidate_decision',
  'create_cull_successor_workspace', 'create_cull_workspace', 'decide_cull_candidate',
  'decide_cull_candidates', 'finalize_cull_workspace', 'get_cull_candidate_history',
  'get_cull_selected_media', 'get_cull_workspace', 'list_cull_workspaces',
  'reject_cull_evidence_mutation', 'require_cull_permission', 'seal_cull_inventory',
  'validate_cull_reason', 'validate_cull_safe_json', 'withdraw_cull_candidate',
  'assign_capture_session',
  'capture_session_assignment',
  'create_capture_session',
  'get_capture_item_record',
  'get_capture_session_record',
  'list_capture_sessions',
  'promote_capture_item',
  'record_capture_duplicate_evidence',
  'record_capture_item_custody',
  'record_capture_item_observation',
  'record_capture_item_verification',
  'record_capture_source_observation',
  'register_capture_item',
  'register_capture_source',
  'reject_capture_evidence_mutation',
  'require_capture_permission',
  'validate_capture_safe_json',
  'append_media_operation_event',
  'attach_media_operation_target',
  'check_media_operation_runtime_idempotency',
  'claim_media_operation',
  'complete_media_operation_attempt',
  'get_media_operation_record',
  'guard_media_operation_projection_mutation',
  'list_claimable_media_operations',
  'list_media_operations',
  'ready_media_operation',
  'record_media_operation_checkpoint',
  'record_media_operation_receipt',
  'record_media_operation_reconciliation',
  'record_media_operation_runtime_idempotency',
  'reject_media_operation_evidence_mutation',
  'request_media_operation',
  'request_media_operation_control',
  'require_media_operation_permission',
  'schedule_media_operation_retry',
  'start_media_operation_attempt',
  'validate_media_operation_safe_json',
  'validate_media_operation_target',
  'add_media_asset_version',
  'check_media_idempotency',
  'create_media_asset',
  'create_media_manifest',
  'designate_media_approved_source',
  'get_media_asset_record',
  'get_media_manifest',
  'record_media_capture_relationship',
  'record_media_idempotency',
  'record_media_lineage',
  'record_media_location_observation',
  'record_media_storage_object',
  'record_media_transfer_event',
  'record_media_verification_event',
  'reject_media_evidence_mutation',
  'require_media_permission',
  'validate_media_safe_json',
  'add_mission_plan_note',
  'actor_can_read_mission_plan',
  'check_mission_plan_idempotency',
  'compute_mission_plan_source_fingerprint',
  'create_mission_plan_draft',
  'create_mission_plan_superseding_draft',
  'get_mission_plan_record',
  'get_mission_plan_sensitive_envelopes',
  'get_operations_home',
  'get_operations_mission_plan_draft_controls',
  'get_operations_order_context',
  'get_operations_order_customer_contacts',
  'guard_mission_plan_draft_update',
  'issue_mission_plan_version',
  'list_mission_plans',
  'list_operations_assignment_candidates',
  'operations_order_context',
  'record_mission_plan_idempotency',
  'record_mission_plan_open_event',
  'record_mission_plan_sensitive_envelope',
  'refresh_mission_plan_draft',
  'reject_mission_plan_evidence_mutation',
  'replace_mission_plan_draft_contacts',
  'replace_mission_plan_draft_workstreams',
  'require_mission_plan_permission',
  'revise_mission_plan_draft',
  'validate_mission_plan_content',
  'accept_scheduling_proposal',
  'actor_can_administer_person',
  'actor_can_read_scheduling',
  'actor_has_permission',
  'actor_is_order_customer',
  'add_scheduling_requested_window',
  'apply_account_lifecycle_transition',
  'apply_catalog_product_administration_defaults',
  'apply_contact_retirement',
  'apply_contact_supersession',
  'apply_primary_email_replacement',
  'assign_appointment_participant',
  'bootstrap_identity_account',
  'bootstrap_person_contact',
  'cancel_appointment',
  'check_job_service_idempotency',
  'check_scheduling_idempotency',
  'close_scheduling_request',
  'confirm_appointment',
  'correct_contact_method',
  'create_catalog_commercial_snapshot',
  'create_catalog_draft_product',
  'create_catalog_product',
  'create_contact_method',
  'create_custom_commercial_snapshot',
  'create_job',
  'create_order',
  'create_property_hub',
  'create_scheduling_request',
  'create_service_workstream',
  'current_appointment_state',
  'current_scheduling_request_state',
  'delete_catalog_draft_product',
  'end_appointment_participant_assignment',
  'get_appointment_record',
  'get_catalog_administration_products',
  'get_current_catalog_package_inclusions',
  'get_current_selectable_catalog',
  'get_job_record',
  'get_order_record',
  'get_property_hub_record',
  'get_scheduling_request_record',
  'get_service_workstream_record',
  'guard_account_lifecycle_transition_insert',
  'guard_account_state_insert',
  'guard_account_state_update',
  'guard_catalog_draft_product_delete',
  'guard_contact_method_insert',
  'guard_contact_method_update',
  'guard_contact_retirement_insert',
  'guard_contact_supersession_insert',
  'guard_contact_verification_insert',
  'guard_job_update',
  'guard_order_relationship_insert',
  'guard_people_primary_email_update',
  'guard_primary_email_replacement_insert',
  'guard_scheduling_window_time',
  'guard_service_workstream_update',
  'guard_verification_invalidation_insert',
  'invalidate_contact_verification',
  'link_job_appointment',
  'normalize_contact_value',
  'propose_scheduling_window',
  'publish_catalog_draft_product',
  'record_appointment_no_show',
  'record_appointment_status',
  'record_appointment_unable_to_complete',
  'record_appointment_weather_delay',
  'record_catalog_external_mapping',
  'record_catalog_price',
  'record_contact_verification',
  'record_job_service_external_reference',
  'record_job_service_idempotency',
  'record_scheduling_idempotency',
  'record_scheduling_offline_acceptance',
  'reject_catalog_evidence_mutation',
  'reject_catalog_product_delete',
  'reject_contact_history_mutation',
  'reject_job_service_evidence_mutation',
  'reject_order_evidence_mutation',
  'reject_property_hub_evidence_mutation',
  'reject_person_external_reference_mutation',
  'reject_property_snapshot_mutation',
  'reconcile_customer_person_intake',
  'reconcile_property_snapshot_intake',
  'reject_scheduling_evidence_mutation',
  'replace_appointment_participant_assignment',
  'replace_catalog_bracket_set',
  'replace_catalog_package_composition',
  'replace_primary_email',
  'require_catalog_permission',
  'require_identity_person',
  'require_job_service_permission',
  'require_order_permission',
  'require_property_hub_permission',
  'require_scheduling_staff',
  'resolve_account_recovery_session',
  'resolve_ordinary_session',
  'retire_contact_method',
  'revise_catalog_draft_product',
  'revise_catalog_product',
  'revise_published_catalog_product_definition',
  'set_catalog_product_archived',
  'supersede_and_reschedule_appointment',
  'transition_account_lifecycle',
  'transition_job_state',
  'transition_service_workstream_state',
  'validate_scheduling_time_evidence',
  'withdraw_scheduling_request'
];

const EXACT_TRIGGERS = [
  ['organization_record_access_events_immutability_guard', 'organization_record_access_events', 'reject_organization_record_evidence_mutation'],
  ['organization_record_export_items_immutability_guard', 'organization_record_export_items', 'reject_organization_record_evidence_mutation'],
  ['organization_record_exports_immutability_guard', 'organization_record_export_snapshots', 'reject_organization_record_evidence_mutation'],
  ['organization_record_revocations_immutability_guard', 'organization_record_personal_summary_revocations', 'reject_organization_record_evidence_mutation'],
  ['organization_record_shares_immutability_guard', 'organization_record_personal_summary_shares', 'reject_organization_record_evidence_mutation'],
  ['tdc_access_credential_current_control_guard', 'temporary_download_center_access_credential_current', 'guard_tdc_access_credential_current_mutation'],
  ['tdc_access_credential_events_immutability_guard', 'temporary_download_center_access_credential_events', 'reject_tdc_access_credential_evidence_mutation'],
  ['tdc_access_credentials_immutability_guard', 'temporary_download_center_access_credentials', 'reject_tdc_access_credential_evidence_mutation'],
  ['tdc_access_credentials_scope_guard', 'temporary_download_center_access_credentials', 'validate_tdc_access_credential_scope'],
  ['temporary_download_center_observations_immutability_guard', 'temporary_download_center_access_observations', 'reject_temporary_download_center_evidence_mutation'],
  ['temporary_download_center_events_immutability_guard', 'temporary_download_center_events', 'reject_temporary_download_center_evidence_mutation'],
  ['tdc_gateway_evaluations_immutability_guard', 'temporary_download_center_gateway_evaluations', 'reject_tdc_access_credential_evidence_mutation'],
  ['temporary_download_center_items_immutability_guard', 'temporary_download_center_items', 'reject_temporary_download_center_evidence_mutation'],
  ['temporary_download_center_selections_immutability_guard', 'temporary_download_center_selections', 'reject_temporary_download_center_evidence_mutation'],
  ['temporary_download_center_versions_immutability_guard', 'temporary_download_center_versions', 'reject_temporary_download_center_evidence_mutation'],
  ['temporary_download_centers_immutability_guard', 'temporary_download_centers', 'reject_temporary_download_center_evidence_mutation'],
  ['delivery_evaluations_immutability_guard', 'delivery_entitlement_evaluations', 'reject_publication_delivery_evidence_mutation'],
  ['delivery_financial_evidence_immutability_guard', 'delivery_financial_eligibility_evidence', 'reject_publication_delivery_evidence_mutation'],
  ['delivery_grant_events_immutability_guard', 'delivery_grant_events', 'reject_publication_delivery_evidence_mutation'],
  ['delivery_grants_immutability_guard', 'delivery_grants', 'reject_publication_delivery_evidence_mutation'],
  ['media_publication_events_immutability_guard', 'media_publication_events', 'reject_publication_delivery_evidence_mutation'],
  ['media_publication_items_immutability_guard', 'media_publication_items', 'reject_publication_delivery_evidence_mutation'],
  ['media_publications_immutability_guard', 'media_publications', 'reject_publication_delivery_evidence_mutation'],
  ['returned_quick_edit_requests_immutability_guard', 'returned_quick_edit_requests', 'reject_returned_review_evidence_mutation'],
  ['returned_quick_edit_version_links_immutability_guard', 'returned_quick_edit_version_links', 'reject_returned_review_evidence_mutation'],
  ['returned_review_batch_events_immutability_guard', 'returned_review_batch_events', 'reject_returned_review_evidence_mutation'],
  ['returned_review_batches_immutability_guard', 'returned_review_batches', 'reject_returned_review_evidence_mutation'],
  ['returned_review_decisions_immutability_guard', 'returned_review_decisions', 'reject_returned_review_evidence_mutation'],
  ['returned_review_items_immutability_guard', 'returned_review_items', 'reject_returned_review_evidence_mutation'],
  ['returned_review_successor_links_immutability_guard', 'returned_review_successor_links', 'reject_returned_review_evidence_mutation'],
  ['returned_revision_requests_immutability_guard', 'returned_revision_requests', 'reject_returned_review_evidence_mutation'],
  ['returned_revision_version_links_immutability_guard', 'returned_revision_version_links', 'reject_returned_review_evidence_mutation'],
  ['editor_handoff_batches_immutability_guard', 'editor_handoff_batches', 'reject_editor_handoff_evidence_mutation'],
  ['editor_handoff_events_immutability_guard', 'editor_handoff_events', 'reject_editor_handoff_evidence_mutation'],
  ['editor_handoff_items_immutability_guard', 'editor_handoff_items', 'reject_editor_handoff_evidence_mutation'],
  ['returned_media_intake_batches_immutability_guard', 'returned_media_intake_batches', 'reject_editor_handoff_evidence_mutation'],
  ['returned_media_intake_events_immutability_guard', 'returned_media_intake_events', 'reject_editor_handoff_evidence_mutation'],
  ['returned_media_items_immutability_guard', 'returned_media_items', 'reject_editor_handoff_evidence_mutation'],
  ['returned_media_match_events_immutability_guard', 'returned_media_match_events', 'reject_editor_handoff_evidence_mutation'],
  ['account_lifecycle_transitions_apply', 'account_lifecycle_transitions', 'apply_account_lifecycle_transition'],
  ['account_lifecycle_transitions_immutability_guard', 'account_lifecycle_transitions', 'reject_contact_history_mutation'],
  ['account_lifecycle_transitions_insert_guard', 'account_lifecycle_transitions', 'guard_account_lifecycle_transition_insert'],
  ['appointment_events_immutability_guard', 'appointment_events', 'reject_scheduling_evidence_mutation'],
  ['appointment_assignment_endings_immutability_guard', 'appointment_participant_assignment_endings', 'reject_scheduling_evidence_mutation'],
  ['appointment_assignments_immutability_guard', 'appointment_participant_assignments', 'reject_scheduling_evidence_mutation'],
  ['appointments_immutability_guard', 'appointments', 'reject_scheduling_evidence_mutation'],
  ['catalog_administration_events_immutability_guard', 'catalog_administration_events', 'reject_catalog_evidence_mutation'],
  ['catalog_bracket_sets_immutability_guard', 'catalog_bracket_sets', 'reject_catalog_evidence_mutation'],
  ['catalog_external_mappings_immutability_guard', 'catalog_external_mappings', 'reject_catalog_evidence_mutation'],
  ['catalog_package_version_items_immutability_guard', 'catalog_package_version_items', 'reject_catalog_evidence_mutation'],
  ['catalog_package_versions_immutability_guard', 'catalog_package_versions', 'reject_catalog_evidence_mutation'],
  ['catalog_price_brackets_immutability_guard', 'catalog_price_brackets', 'reject_catalog_evidence_mutation'],
  ['catalog_prices_immutability_guard', 'catalog_prices', 'reject_catalog_evidence_mutation'],
  ['catalog_product_change_events_immutability_guard', 'catalog_product_change_events', 'reject_catalog_evidence_mutation'],
  ['catalog_products_administration_defaults', 'catalog_products', 'apply_catalog_product_administration_defaults'],
  ['catalog_products_delete_guard', 'catalog_products', 'guard_catalog_draft_product_delete'],
  ['commercial_snapshot_package_items_immutability_guard', 'commercial_snapshot_package_items', 'reject_catalog_evidence_mutation'],
  ['commercial_snapshots_immutability_guard', 'commercial_snapshots', 'reject_catalog_evidence_mutation'],
  ['contact_method_retirements_apply', 'contact_method_retirements', 'apply_contact_retirement'],
  ['contact_method_retirements_immutability_guard', 'contact_method_retirements', 'reject_contact_history_mutation'],
  ['contact_method_retirements_insert_guard', 'contact_method_retirements', 'guard_contact_retirement_insert'],
  ['contact_method_supersessions_apply', 'contact_method_supersessions', 'apply_contact_supersession'],
  ['contact_method_supersessions_immutability_guard', 'contact_method_supersessions', 'reject_contact_history_mutation'],
  ['contact_method_supersessions_insert_guard', 'contact_method_supersessions', 'guard_contact_supersession_insert'],
  ['contact_methods_delete_guard', 'contact_methods', 'reject_contact_history_mutation'],
  ['contact_methods_insert_guard', 'contact_methods', 'guard_contact_method_insert'],
  ['contact_methods_update_guard', 'contact_methods', 'guard_contact_method_update'],
  ['contact_verification_evidence_immutability_guard', 'contact_verification_evidence', 'reject_contact_history_mutation'],
  ['contact_verification_evidence_insert_guard', 'contact_verification_evidence', 'guard_contact_verification_insert'],
  ['contact_verification_invalidations_immutability_guard', 'contact_verification_invalidations', 'reject_contact_history_mutation'],
  ['contact_verification_invalidations_insert_guard', 'contact_verification_invalidations', 'guard_verification_invalidation_insert'],
  ['cull_candidate_inventory_events_immutability_guard', 'cull_candidate_inventory_events', 'reject_cull_evidence_mutation'],
  ['cull_candidate_relationship_contexts_immutability_guard', 'cull_candidate_relationship_contexts', 'reject_cull_evidence_mutation'],
  ['cull_candidates_immutability_guard', 'cull_candidates', 'reject_cull_evidence_mutation'],
  ['cull_decision_batches_immutability_guard', 'cull_decision_batches', 'reject_cull_evidence_mutation'],
  ['cull_decision_events_immutability_guard', 'cull_decision_events', 'reject_cull_evidence_mutation'],
  ['cull_inventory_seals_immutability_guard', 'cull_inventory_seals', 'reject_cull_evidence_mutation'],
  ['cull_selection_designation_events_immutability_guard', 'cull_selection_designation_events', 'reject_cull_evidence_mutation'],
  ['cull_workspace_completions_immutability_guard', 'cull_workspace_completions', 'reject_cull_evidence_mutation'],
  ['cull_workspace_events_immutability_guard', 'cull_workspace_events', 'reject_cull_evidence_mutation'],
  ['cull_workspaces_immutability_guard', 'cull_workspaces', 'reject_cull_evidence_mutation'],
  ['custom_commercial_snapshots_immutability_guard', 'custom_commercial_snapshots', 'reject_catalog_evidence_mutation'],
  ['identities_account_bootstrap', 'identities', 'bootstrap_identity_account'],
  ['job_appointments_immutability_guard', 'job_appointments', 'reject_job_service_evidence_mutation'],
  ['job_events_immutability_guard', 'job_events', 'reject_job_service_evidence_mutation'],
  ['job_service_command_idempotency_immutability_guard', 'job_service_command_idempotency', 'reject_job_service_evidence_mutation'],
  ['job_service_external_references_immutability_guard', 'job_service_external_references', 'reject_job_service_evidence_mutation'],
  ['jobs_delete_guard', 'jobs', 'reject_job_service_evidence_mutation'],
  ['jobs_update_guard', 'jobs', 'guard_job_update'],
  ['order_events_immutability_guard', 'order_events', 'reject_order_evidence_mutation'],
  ['order_external_references_immutability_guard', 'order_external_references', 'reject_order_evidence_mutation'],
  ['order_idempotency_records_immutability_guard', 'order_idempotency_records', 'reject_order_evidence_mutation'],
  ['order_items_immutability_guard', 'order_items', 'reject_order_evidence_mutation'],
  ['order_parties_immutability_guard', 'order_parties', 'reject_order_evidence_mutation'],
  ['order_relationships_immutability_guard', 'order_relationships', 'reject_order_evidence_mutation'],
  ['order_relationships_insert_guard', 'order_relationships', 'guard_order_relationship_insert'],
  ['orders_immutability_guard', 'orders', 'reject_order_evidence_mutation'],
  ['people_contact_bootstrap', 'people', 'bootstrap_person_contact'],
  ['person_external_references_immutability_guard', 'person_external_references', 'reject_person_external_reference_mutation'],
  ['people_primary_email_update_guard', 'people', 'guard_people_primary_email_update'],
  ['person_account_states_delete_guard', 'person_account_states', 'reject_contact_history_mutation'],
  ['person_account_states_insert_guard', 'person_account_states', 'guard_account_state_insert'],
  ['person_account_states_update_guard', 'person_account_states', 'guard_account_state_update'],
  ['primary_email_replacements_apply', 'primary_email_replacements', 'apply_primary_email_replacement'],
  ['primary_email_replacements_immutability_guard', 'primary_email_replacements', 'reject_contact_history_mutation'],
  ['primary_email_replacements_insert_guard', 'primary_email_replacements', 'guard_primary_email_replacement_insert'],
  ['property_hub_events_immutability_guard', 'property_hub_events', 'reject_property_hub_evidence_mutation'],
  ['property_hub_external_references_immutability_guard', 'property_hub_external_references', 'reject_property_hub_evidence_mutation'],
  ['property_hub_idempotency_records_immutability_guard', 'property_hub_idempotency_records', 'reject_property_hub_evidence_mutation'],
  ['property_hub_orders_immutability_guard', 'property_hub_orders', 'reject_property_hub_evidence_mutation'],
  ['property_hub_participants_immutability_guard', 'property_hub_participants', 'reject_property_hub_evidence_mutation'],
  ['property_hubs_immutability_guard', 'property_hubs', 'reject_property_hub_evidence_mutation'],
  ['property_snapshots_immutability_guard', 'property_snapshots', 'reject_property_snapshot_mutation'],
  ['scheduling_acceptances_immutability_guard', 'scheduling_acceptances', 'reject_scheduling_evidence_mutation'],
  ['scheduling_command_idempotency_immutability_guard', 'scheduling_command_idempotency', 'reject_scheduling_evidence_mutation'],
  ['scheduling_external_references_immutability_guard', 'scheduling_external_references', 'reject_scheduling_evidence_mutation'],
  ['scheduling_request_events_immutability_guard', 'scheduling_request_events', 'reject_scheduling_evidence_mutation'],
  ['scheduling_requests_immutability_guard', 'scheduling_requests', 'reject_scheduling_evidence_mutation'],
  ['scheduling_windows_immutability_guard', 'scheduling_windows', 'reject_scheduling_evidence_mutation'],
  ['scheduling_windows_time_guard', 'scheduling_windows', 'guard_scheduling_window_time'],
  ['service_workstream_events_immutability_guard', 'service_workstream_events', 'reject_job_service_evidence_mutation'],
  ['service_workstreams_delete_guard', 'service_workstreams', 'reject_job_service_evidence_mutation'],
  ['service_workstreams_update_guard', 'service_workstreams', 'guard_service_workstream_update'],
  ['mission_plan_command_idempotency_immutability_guard', 'mission_plan_command_idempotency', 'reject_mission_plan_evidence_mutation'],
  ['mission_plan_drafts_delete_guard', 'mission_plan_drafts', 'reject_mission_plan_evidence_mutation'],
  ['mission_plan_drafts_update_guard', 'mission_plan_drafts', 'guard_mission_plan_draft_update'],
  ['mission_plan_events_immutability_guard', 'mission_plan_events', 'reject_mission_plan_evidence_mutation'],
  ['mission_plan_notes_immutability_guard', 'mission_plan_notes', 'reject_mission_plan_evidence_mutation'],
  ['mission_plan_open_events_immutability_guard', 'mission_plan_open_events', 'reject_mission_plan_evidence_mutation'],
  ['mission_plan_sensitive_envelopes_immutability_guard', 'mission_plan_sensitive_envelopes', 'reject_mission_plan_evidence_mutation'],
  ['mission_plan_version_contacts_immutability_guard', 'mission_plan_version_contacts', 'reject_mission_plan_evidence_mutation'],
  ['mission_plan_version_notes_immutability_guard', 'mission_plan_version_notes', 'reject_mission_plan_evidence_mutation'],
  ['mission_plan_version_workstreams_immutability_guard', 'mission_plan_version_workstreams', 'reject_mission_plan_evidence_mutation'],
  ['mission_plan_versions_immutability_guard', 'mission_plan_versions', 'reject_mission_plan_evidence_mutation'],
  ['mission_plans_immutability_guard', 'mission_plans', 'reject_mission_plan_evidence_mutation']
  ,['media_assets_immutability_guard', 'media_assets', 'reject_media_evidence_mutation']
  ,['media_asset_versions_immutability_guard', 'media_asset_versions', 'reject_media_evidence_mutation']
  ,['media_asset_lineage_immutability_guard', 'media_asset_lineage', 'reject_media_evidence_mutation']
  ,['media_capture_relationships_immutability_guard', 'media_capture_relationships', 'reject_media_evidence_mutation']
  ,['media_storage_objects_immutability_guard', 'media_storage_objects', 'reject_media_evidence_mutation']
  ,['media_location_observations_immutability_guard', 'media_location_observations', 'reject_media_evidence_mutation']
  ,['media_verification_events_immutability_guard', 'media_verification_events', 'reject_media_evidence_mutation']
  ,['media_transfer_events_immutability_guard', 'media_transfer_events', 'reject_media_evidence_mutation']
  ,['media_designations_immutability_guard', 'media_approved_source_designations', 'reject_media_evidence_mutation']
  ,['media_manifests_immutability_guard', 'media_manifests', 'reject_media_evidence_mutation']
  ,['media_command_idempotency_immutability_guard', 'media_command_idempotency', 'reject_media_evidence_mutation']
  ,['media_operations_immutability_guard', 'media_operations', 'reject_media_operation_evidence_mutation']
  ,['media_operation_targets_validation_guard', 'media_operation_targets', 'validate_media_operation_target']
  ,['media_operation_targets_immutability_guard', 'media_operation_targets', 'reject_media_operation_evidence_mutation']
  ,['media_operation_attempts_immutability_guard', 'media_operation_attempts', 'reject_media_operation_evidence_mutation']
  ,['media_operation_checkpoints_immutability_guard', 'media_operation_checkpoints', 'reject_media_operation_evidence_mutation']
  ,['media_operation_receipts_immutability_guard', 'media_operation_receipts', 'reject_media_operation_evidence_mutation']
  ,['media_operation_control_requests_immutability_guard', 'media_operation_control_requests', 'reject_media_operation_evidence_mutation']
  ,['media_operation_reconciliations_immutability_guard', 'media_operation_reconciliations', 'reject_media_operation_evidence_mutation']
  ,['media_operation_runtime_idempotency_immutability_guard', 'media_operation_runtime_idempotency', 'reject_media_operation_evidence_mutation']
  ,['media_operation_events_immutability_guard', 'media_operation_events', 'reject_media_operation_evidence_mutation']
  ,['media_operation_projections_control_guard', 'media_operation_projections', 'guard_media_operation_projection_mutation']
  ,['capture_sessions_immutability_guard', 'capture_sessions', 'reject_capture_evidence_mutation']
  ,['capture_session_assignments_immutability_guard', 'capture_session_assignments', 'reject_capture_evidence_mutation']
  ,['capture_session_events_immutability_guard', 'capture_session_events', 'reject_capture_evidence_mutation']
  ,['capture_sources_immutability_guard', 'capture_sources', 'reject_capture_evidence_mutation']
  ,['capture_source_observations_immutability_guard', 'capture_source_observations', 'reject_capture_evidence_mutation']
  ,['capture_items_immutability_guard', 'capture_items', 'reject_capture_evidence_mutation']
  ,['capture_item_observations_immutability_guard', 'capture_item_observations', 'reject_capture_evidence_mutation']
  ,['capture_item_verification_immutability_guard', 'capture_item_verification_events', 'reject_capture_evidence_mutation']
  ,['capture_item_custody_immutability_guard', 'capture_item_custody_events', 'reject_capture_evidence_mutation']
  ,['capture_duplicate_evidence_immutability_guard', 'capture_duplicate_evidence', 'reject_capture_evidence_mutation']
  ,['capture_item_promotions_immutability_guard', 'capture_item_promotions', 'reject_capture_evidence_mutation']
  ,['media_technical_observations_immutability_guard', 'media_technical_observations', 'reject_editorial_evidence_mutation']
  ,['editorial_segments_immutability_guard', 'editorial_segments', 'reject_editorial_evidence_mutation']
  ,['editorial_segment_versions_immutability_guard', 'editorial_segment_versions', 'reject_editorial_evidence_mutation']
  ,['editorial_segment_decision_events_immutability_guard', 'editorial_segment_decision_events', 'reject_editorial_evidence_mutation']
].map(([trigger_name, table_name, function_name]) => ({
  trigger_name,
  table_name,
  schema_name: 'medialab_core',
  function_name
})).sort((a, b) =>
  a.schema_name.localeCompare(b.schema_name) ||
  a.table_name.localeCompare(b.table_name) ||
  a.trigger_name.localeCompare(b.trigger_name)
);

describe('P01C Test Database Reset Tooling Tests', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = new pg.Client({
      host: TEST_SOCKET,
      port: TEST_PORT,
      database: TEST_DB,
      user: TEST_ROLE
    });
    await client.connect();
  });

  afterAll(async () => {
    if (client) {
      await client.end();
    }
  });

  it('1. reset refuses development database targets under any flag/alias', async () => {
    await expect(
      resetTestDatabase({
        database: 'medialab_p02m04a',
        confirm: 'medialab_p02m04a',
        host: TEST_SOCKET,
        port: TEST_PORT
      })
    ).rejects.toThrow(/TEST_RESET_GUARD_FAILURE/);
  });

  it('2. reset refuses missing or incorrect confirmation values', async () => {
    await expect(
      resetTestDatabase({
        database: TEST_DB,
        confirm: '',
        host: TEST_SOCKET,
        port: TEST_PORT
      })
    ).rejects.toThrow(/TEST_RESET_GUARD_FAILURE/);

    await expect(
      resetTestDatabase({
        database: TEST_DB,
        confirm: 'WRONG_CONFIRMATION',
        host: TEST_SOCKET,
        port: TEST_PORT
      })
    ).rejects.toThrow(/TEST_RESET_GUARD_FAILURE/);
  });

  it('3. reset refuses TCP or external host connection targets', async () => {
    await expect(
      resetTestDatabase({
        database: TEST_DB,
        confirm: TEST_DB,
        host: '127.0.0.1',
        port: TEST_PORT
      })
    ).rejects.toThrow(/TEST_RESET_GUARD_FAILURE/);
  });

  it('4. reset removes deliberate disposable drift and reconstructs exact schema and fixtures', async () => {
    // Introduce deliberate disposable drift: create a dummy table in medialab_core
    await client.query('CREATE TABLE medialab_core.__disposable_test_drift (id int PRIMARY KEY);');
    const checkDriftBefore = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'medialab_core' AND table_name = '__disposable_test_drift';"
    );
    expect(checkDriftBefore.rows).toHaveLength(1);

    // Execute reset
    await resetTestDatabase({
      database: TEST_DB,
      confirm: TEST_DB,
      host: TEST_SOCKET,
      port: TEST_PORT,
      user: TEST_ROLE
    });

    // Verify disposable drift table is completely gone
    const checkDriftAfter = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'medialab_core' AND table_name = '__disposable_test_drift';"
    );
    expect(checkDriftAfter.rows).toHaveLength(0);

    // Verify canonical migration ledger
    const ledgerRes = await client.query('SELECT filename, sha256 FROM medialab_meta.schema_migrations ORDER BY filename ASC;');
    expect(ledgerRes.rows).toHaveLength(26);
    expect(ledgerRes.rows[22].filename).toBe('0023_runtime_intake_reconciliation_commands.sql');
    expect(ledgerRes.rows[0].filename).toBe('0001_identity_and_tenancy.sql');
    expect(ledgerRes.rows[0].sha256).toBe('29dc9fd8e500ba4c7bfaeb967773b17f7f2d7d05fd98b9df755d9179eb033f31');
    expect(ledgerRes.rows[1].filename).toBe('0002_property_identity_and_snapshots.sql');
    expect(ledgerRes.rows[1].sha256).toBe('d3ca6e17cde090eceb2e3b4ac5581af3cf3431a4d64f668f80ab01725d777a83');
    expect(ledgerRes.rows[2].filename).toBe('0003_person_contacts_and_account_lifecycle.sql');
    expect(ledgerRes.rows[2].sha256).toBe('984577c586ed2b04aa142e33614eedcc5a957f0a64a2f0ad157f96644b08d3c3');
    expect(ledgerRes.rows[3].filename).toBe('0004_current_catalog_and_price_snapshots.sql');
    expect(ledgerRes.rows[3].sha256).toBe('e9ee756cd27df247c163829f81ff43db72317d3df243d218015c69558d3da876');
    expect(ledgerRes.rows[4].filename).toBe('0005_catalog_administration_lifecycle.sql');
    expect(ledgerRes.rows[4].sha256).toBe('928ffdfa7fc1064471e387ebaf51c7be6aa3b57d70a75e39569bc169f845cf40');
    expect(ledgerRes.rows[5].filename).toBe('0006_orders_and_immutable_commercial_evidence.sql');
    expect(ledgerRes.rows[5].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(ledgerRes.rows[6].filename).toBe('0007_property_hub_foundation.sql');
    expect(ledgerRes.rows[7].filename).toBe('0008_scheduling_request_and_appointment_foundation.sql');
    expect(ledgerRes.rows[8].filename).toBe('0009_job_and_service_workstream_foundation.sql');
    expect(ledgerRes.rows[9].filename).toBe('0010_mission_plan_foundation.sql');
    expect(ledgerRes.rows[10].filename).toBe('0011_media_asset_identity_and_lineage_foundation.sql');
    expect(ledgerRes.rows[11].filename).toBe('0012_durable_media_operations_reconciliation_foundation.sql');
    expect(ledgerRes.rows[12].filename).toBe('0013_capture_session_ingest_custody_foundation.sql');
    expect(ledgerRes.rows[13].filename).toBe('0014_media_cull_workspace_selected_media_evidence_foundation.sql');
    expect(ledgerRes.rows[14].filename).toBe('0015_editor_handoff_returned_media_intake_foundation.sql');
    expect(ledgerRes.rows[15].filename).toBe('0016_returned_editor_review_final_source_decision_foundation.sql');
    expect(ledgerRes.rows[16].filename).toBe('0017_publication_delivery_entitlement_foundation.sql');
    expect(ledgerRes.rows[17].filename).toBe('0018_temporary_download_center_external_sharing_foundation.sql');
    expect(ledgerRes.rows[18].filename).toBe('0019_temporary_download_center_access_credential_gateway_foundation.sql');
    expect(ledgerRes.rows[19].filename).toBe('0020_disposable_delivery_surface_local_fixture_foundation.sql');
    expect(ledgerRes.rows[20].filename).toBe('0021_provider_neutral_file_backed_disposable_delivery_foundation.sql');
    expect(ledgerRes.rows[21].filename).toBe('0022_organization_records_dashboard_audited_export_foundation.sql');
    expect(ledgerRes.rows[6].sha256).toMatch(/^[0-9a-f]{64}$/);

    // Verify row counts across the predecessor and packet fixture inventories.
    const expectedCounts: Record<string, number> = { ...EXPECTED_ROW_COUNTS, ...CATALOG_EXPECTED_ROW_COUNTS };
    for (const [table, count] of Object.entries(CURRENT_REAL_ESTATE_EXPECTED_ROW_COUNTS)) {
      expectedCounts[table] = (expectedCounts[table] ?? 0) + count;
    }
    for (const [table, count] of Object.entries(ORDER_FOUNDATION_ROW_COUNT_INCREMENTS)) {
      expectedCounts[table] = (expectedCounts[table] ?? 0) + count;
    }
    for (const [table, count] of Object.entries(PROPERTY_HUB_FOUNDATION_ROW_COUNT_INCREMENTS)) {
      expectedCounts[table] = (expectedCounts[table] ?? 0) + count;
    }
    for (const [table, count] of Object.entries(SCHEDULING_APPOINTMENT_FOUNDATION_ROW_COUNT_INCREMENTS)) {
      expectedCounts[table] = (expectedCounts[table] ?? 0) + count;
    }
    for (const [table, count] of Object.entries(JOB_SERVICE_WORKSTREAM_FOUNDATION_ROW_COUNT_INCREMENTS)) {
      expectedCounts[table] = (expectedCounts[table] ?? 0) + count;
    }
    for (const [table, count] of Object.entries(MISSION_PLAN_FOUNDATION_ROW_COUNT_INCREMENTS)) {
      expectedCounts[table] = (expectedCounts[table] ?? 0) + count;
    }
    for (const [table, count] of Object.entries(MEDIA_ASSET_FOUNDATION_ROW_COUNT_INCREMENTS)) {
      expectedCounts[table] = (expectedCounts[table] ?? 0) + count;
    }
    for (const [table, count] of Object.entries(MEDIA_OPERATION_FOUNDATION_ROW_COUNT_INCREMENTS)) {
      expectedCounts[table] = (expectedCounts[table] ?? 0) + count;
    }
    for (const [table, count] of Object.entries(MEDIA_CAPTURE_FOUNDATION_ROW_COUNT_INCREMENTS)) {
      expectedCounts[table] = (expectedCounts[table] ?? 0) + count;
    }
    for (const [table, count] of Object.entries(MEDIA_CULL_FOUNDATION_ROW_COUNT_INCREMENTS)) {
      expectedCounts[table] = (expectedCounts[table] ?? 0) + count;
    }
    for (const [table, count] of Object.entries(MEDIA_EDITOR_HANDOFF_FOUNDATION_ROW_COUNT_INCREMENTS)) {
      expectedCounts[table] = (expectedCounts[table] ?? 0) + count;
    }
    for (const [table, count] of Object.entries(MEDIA_RETURN_REVIEW_FOUNDATION_ROW_COUNT_INCREMENTS)) {
      expectedCounts[table] = (expectedCounts[table] ?? 0) + count;
    }
    for (const [table, count] of Object.entries(PUBLICATION_DELIVERY_FOUNDATION_ROW_COUNT_INCREMENTS)) {
      expectedCounts[table] = (expectedCounts[table] ?? 0) + count;
    }
    for (const [table, count] of Object.entries(TEMPORARY_DOWNLOAD_CENTER_FOUNDATION_ROW_COUNT_INCREMENTS)) {
      expectedCounts[table] = (expectedCounts[table] ?? 0) + count;
    }
    for (const [table, count] of Object.entries(EDITORIAL_SEGMENT_FOUNDATION_ROW_COUNT_INCREMENTS)) {
      expectedCounts[table] = (expectedCounts[table] ?? 0) + count;
    }
    for (const [table, expectedCount] of Object.entries(expectedCounts)) {
      const countRes = await client.query(`SELECT COUNT(*)::int AS cnt FROM medialab_core.${table};`);
      expect(countRes.rows[0].cnt).toBe(expectedCount);
    }

    // Verify no extra views or sequences exist
    const viewsRes = await client.query(
      "SELECT table_name FROM information_schema.views WHERE table_schema NOT IN ('pg_catalog', 'information_schema');"
    );
    expect(viewsRes.rows).toHaveLength(0);

    const seqRes = await client.query(
      "SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema NOT IN ('pg_catalog', 'information_schema');"
    );
    expect(seqRes.rows).toHaveLength(0);

    // Verify the exact released and additive routine inventory.
    const routRes = await client.query(
      `SELECT routine_schema, routine_name, routine_type
       FROM information_schema.routines
       WHERE routine_schema NOT IN ('pg_catalog', 'information_schema')
       ORDER BY routine_schema, routine_name;`
    );
    expect(routRes.rows).toEqual(
      [...EXACT_ROUTINE_NAMES].sort().map((routine_name) => ({
        routine_schema: 'medialab_core',
        routine_name,
        routine_type: 'FUNCTION'
      }))
    );

    // Verify the exact released and additive trigger inventory.
    const trigRes = await client.query(
      `SELECT 
          t.tgname AS trigger_name,
          c.relname AS table_name,
          n.nspname AS schema_name,
          p.proname AS function_name
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_proc p ON p.oid = t.tgfoid
       WHERE NOT t.tgisinternal
         AND n.nspname NOT IN ('pg_catalog', 'information_schema')
       ORDER BY n.nspname, c.relname, t.tgname;`
    );
    expect(trigRes.rows).toEqual(EXACT_TRIGGERS);

    // Verify trigger timing and manipulation events
    const trigEventRes = await client.query(
      `SELECT event_manipulation, action_timing
       FROM information_schema.triggers
       WHERE event_object_schema = 'medialab_core'
         AND event_object_table = 'property_snapshots'
         AND trigger_name = 'property_snapshots_immutability_guard'
       ORDER BY event_manipulation;`
    );
    expect(trigEventRes.rows).toHaveLength(2);
    expect(trigEventRes.rows[0].action_timing).toBe('BEFORE');
    expect(trigEventRes.rows[0].event_manipulation).toBe('DELETE');
    expect(trigEventRes.rows[1].action_timing).toBe('BEFORE');
    expect(trigEventRes.rows[1].event_manipulation).toBe('UPDATE');
  });
});
