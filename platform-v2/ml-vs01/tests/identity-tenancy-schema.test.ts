import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import { resetTestDatabase } from '../db/reset-test-database.js';
import pkg from 'pg';
const { Pool } = pkg;
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const EXACT_ROUTINE_NAMES = [
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
  'get_temporary_download_center_gateway_history',
  'guard_tdc_access_credential_current_mutation',
  'issue_temporary_download_center_access_credential',
  'reject_tdc_access_credential_evidence_mutation',
  'revoke_temporary_download_center_access_credential',
  'resolve_temporary_download_center_delivery_source',
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
  'complete_editor_handoff_returns',
  'create_editor_handoff_batch',
  'create_returned_media_intake_batch',
  'create_returned_version_for_match',
  'get_editor_handoff_batch',
  'get_returned_media_history',
  'list_editor_handoff_batches',
  'record_editor_handoff_event',
  'record_returned_media_item',
  'recompute_editor_handoff_current',
  'reject_editor_handoff_evidence_mutation',
  'require_editor_handoff_permission',
  'resolve_returned_media_match',
  'validate_editor_handoff_reason',
  'validate_editor_handoff_safe_json',
  'admit_cull_candidate',
  'admit_cull_candidates',
  'clear_cull_candidate_decision',
  'create_cull_successor_workspace',
  'create_cull_workspace',
  'decide_cull_candidate',
  'decide_cull_candidates',
  'finalize_cull_workspace',
  'get_cull_candidate_history',
  'get_cull_selected_media',
  'get_cull_workspace',
  'list_cull_workspaces',
  'reject_cull_evidence_mutation',
  'require_cull_permission',
  'seal_cull_inventory',
  'validate_cull_reason',
  'validate_cull_safe_json',
  'withdraw_cull_candidate',
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
  'accept_scheduling_proposal',
  'actor_can_administer_person',
  'actor_can_read_scheduling',
  'actor_can_read_mission_plan',
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
  'check_mission_plan_idempotency',
  'check_scheduling_idempotency',
  'close_scheduling_request',
  'confirm_appointment',
  'compute_mission_plan_source_fingerprint',
  'correct_contact_method',
  'create_catalog_commercial_snapshot',
  'create_catalog_draft_product',
  'create_catalog_product',
  'create_contact_method',
  'create_custom_commercial_snapshot',
  'create_job',
  'create_mission_plan_draft',
  'create_mission_plan_superseding_draft',
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
  'get_mission_plan_record',
  'get_mission_plan_sensitive_envelopes',
  'get_operations_home',
  'get_operations_order_context',
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
  'guard_mission_plan_draft_update',
  'guard_order_relationship_insert',
  'guard_people_primary_email_update',
  'guard_primary_email_replacement_insert',
  'guard_scheduling_window_time',
  'guard_service_workstream_update',
  'guard_verification_invalidation_insert',
  'invalidate_contact_verification',
  'issue_mission_plan_version',
  'link_job_appointment',
  'list_mission_plans',
  'list_operations_assignment_candidates',
  'normalize_contact_value',
  'operations_order_context',
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
  'record_mission_plan_idempotency',
  'record_mission_plan_open_event',
  'record_mission_plan_sensitive_envelope',
  'record_scheduling_idempotency',
  'record_scheduling_offline_acceptance',
  'reject_catalog_evidence_mutation',
  'reject_catalog_product_delete',
  'reject_contact_history_mutation',
  'reject_job_service_evidence_mutation',
  'reject_mission_plan_evidence_mutation',
  'reject_order_evidence_mutation',
  'reject_property_hub_evidence_mutation',
  'reject_person_external_reference_mutation',
  'reject_property_snapshot_mutation',
  'reconcile_customer_person_intake',
  'reconcile_property_snapshot_intake',
  'reject_scheduling_evidence_mutation',
  'replace_appointment_participant_assignment',
  'replace_mission_plan_draft_contacts',
  'replace_mission_plan_draft_workstreams',
  'replace_catalog_bracket_set',
  'replace_catalog_package_composition',
  'replace_primary_email',
  'require_catalog_permission',
  'require_identity_person',
  'require_job_service_permission',
  'require_mission_plan_permission',
  'require_order_permission',
  'require_property_hub_permission',
  'require_scheduling_staff',
  'resolve_account_recovery_session',
  'resolve_ordinary_session',
  'retire_contact_method',
  'refresh_mission_plan_draft',
  'revise_catalog_draft_product',
  'revise_catalog_product',
  'revise_mission_plan_draft',
  'revise_published_catalog_product_definition',
  'set_catalog_product_archived',
  'supersede_and_reschedule_appointment',
  'transition_account_lifecycle'
  ,'transition_job_state'
  ,'transition_service_workstream_state'
  ,'validate_mission_plan_content'
  ,'validate_scheduling_time_evidence'
  ,'withdraw_scheduling_request'
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
  ['property_snapshots_immutability_guard', 'property_snapshots', 'reject_property_snapshot_mutation']
  ,['scheduling_acceptances_immutability_guard', 'scheduling_acceptances', 'reject_scheduling_evidence_mutation']
  ,['scheduling_command_idempotency_immutability_guard', 'scheduling_command_idempotency', 'reject_scheduling_evidence_mutation']
  ,['scheduling_external_references_immutability_guard', 'scheduling_external_references', 'reject_scheduling_evidence_mutation']
  ,['scheduling_request_events_immutability_guard', 'scheduling_request_events', 'reject_scheduling_evidence_mutation']
  ,['scheduling_requests_immutability_guard', 'scheduling_requests', 'reject_scheduling_evidence_mutation']
  ,['scheduling_windows_immutability_guard', 'scheduling_windows', 'reject_scheduling_evidence_mutation']
  ,['scheduling_windows_time_guard', 'scheduling_windows', 'guard_scheduling_window_time']
  ,['service_workstream_events_immutability_guard', 'service_workstream_events', 'reject_job_service_evidence_mutation']
  ,['service_workstreams_delete_guard', 'service_workstreams', 'reject_job_service_evidence_mutation']
  ,['service_workstreams_update_guard', 'service_workstreams', 'guard_service_workstream_update']
  ,['mission_plan_command_idempotency_immutability_guard', 'mission_plan_command_idempotency', 'reject_mission_plan_evidence_mutation']
  ,['mission_plan_drafts_delete_guard', 'mission_plan_drafts', 'reject_mission_plan_evidence_mutation']
  ,['mission_plan_drafts_update_guard', 'mission_plan_drafts', 'guard_mission_plan_draft_update']
  ,['mission_plan_events_immutability_guard', 'mission_plan_events', 'reject_mission_plan_evidence_mutation']
  ,['mission_plan_notes_immutability_guard', 'mission_plan_notes', 'reject_mission_plan_evidence_mutation']
  ,['mission_plan_open_events_immutability_guard', 'mission_plan_open_events', 'reject_mission_plan_evidence_mutation']
  ,['mission_plan_sensitive_envelopes_immutability_guard', 'mission_plan_sensitive_envelopes', 'reject_mission_plan_evidence_mutation']
  ,['mission_plan_version_contacts_immutability_guard', 'mission_plan_version_contacts', 'reject_mission_plan_evidence_mutation']
  ,['mission_plan_version_notes_immutability_guard', 'mission_plan_version_notes', 'reject_mission_plan_evidence_mutation']
  ,['mission_plan_version_workstreams_immutability_guard', 'mission_plan_version_workstreams', 'reject_mission_plan_evidence_mutation']
  ,['mission_plan_versions_immutability_guard', 'mission_plan_versions', 'reject_mission_plan_evidence_mutation']
  ,['mission_plans_immutability_guard', 'mission_plans', 'reject_mission_plan_evidence_mutation']
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
  ,['media_operation_attempts_immutability_guard', 'media_operation_attempts', 'reject_media_operation_evidence_mutation']
  ,['media_operation_checkpoints_immutability_guard', 'media_operation_checkpoints', 'reject_media_operation_evidence_mutation']
  ,['media_operation_control_requests_immutability_guard', 'media_operation_control_requests', 'reject_media_operation_evidence_mutation']
  ,['media_operation_events_immutability_guard', 'media_operation_events', 'reject_media_operation_evidence_mutation']
  ,['media_operation_projections_control_guard', 'media_operation_projections', 'guard_media_operation_projection_mutation']
  ,['media_operation_receipts_immutability_guard', 'media_operation_receipts', 'reject_media_operation_evidence_mutation']
  ,['media_operation_reconciliations_immutability_guard', 'media_operation_reconciliations', 'reject_media_operation_evidence_mutation']
  ,['media_operation_runtime_idempotency_immutability_guard', 'media_operation_runtime_idempotency', 'reject_media_operation_evidence_mutation']
  ,['media_operation_targets_immutability_guard', 'media_operation_targets', 'reject_media_operation_evidence_mutation']
  ,['media_operation_targets_validation_guard', 'media_operation_targets', 'validate_media_operation_target']
  ,['media_operations_immutability_guard', 'media_operations', 'reject_media_operation_evidence_mutation']
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
].map(([trigger_name, table_name, function_name]) => ({ trigger_name, table_name, function_name }))
  .sort((a, b) => a.table_name.localeCompare(b.table_name) || a.trigger_name.localeCompare(b.trigger_name));

describe('M02 Identity and Tenancy Schema', () => {
  const poolTest = new Pool({
    host: '/tmp/mlvs01-p02m16a-pg',
    port: 55447,
    database: 'medialab_p02m16a_test',
    user: 'medialab_p02m16a_test_owner'
  });

  beforeAll(async () => {
    await resetTestDatabase({
      host: '/tmp/mlvs01-p02m16a-pg', port: 55447, database: 'medialab_p02m16a_test',
      user: 'medialab_p02m16a_test_owner', runtimeUser: 'medialab_p02m16a_test_app', confirm: 'medialab_p02m16a_test'
    });
  }, 30_000);

  afterAll(async () => {
    await poolTest.end();
  }, 30_000);

  it('1. Canonical migration scripts are path-independent and the approved test database is a clean no-op', async () => {
    const cwd = path.resolve(__dirname, '..');
    const packageJson = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));

    expect(packageJson.scripts['migrate:dev']).toBe('tsx db/migrate.ts');
    expect(packageJson.scripts['migrate:test']).toBe('tsx db/migrate.ts --test');

    const migrationsDir = path.join(cwd, 'db/migrations');

    const outTest = await runMigrations({
      migrationsDir,
      host: '/tmp/mlvs01-p02m16a-pg',
      port: 55447,
      database: 'medialab_p02m16a_test',
      user: 'medialab_p02m16a_test_owner',
      runtimeUser: 'medialab_p02m16a_test_app'
    });

    expect(outTest.applied).toEqual([]);
    expect(outTest.skipped).toEqual([
      '0001_identity_and_tenancy.sql',
      '0002_property_identity_and_snapshots.sql',
      '0003_person_contacts_and_account_lifecycle.sql',
      '0004_current_catalog_and_price_snapshots.sql',
      '0005_catalog_administration_lifecycle.sql',
      '0006_orders_and_immutable_commercial_evidence.sql',
      '0007_property_hub_foundation.sql',
      '0008_scheduling_request_and_appointment_foundation.sql'
      ,'0009_job_and_service_workstream_foundation.sql'
      ,'0010_mission_plan_foundation.sql'
      ,'0011_media_asset_identity_and_lineage_foundation.sql'
      ,'0012_durable_media_operations_reconciliation_foundation.sql'
      ,'0013_capture_session_ingest_custody_foundation.sql'
      ,'0014_media_cull_workspace_selected_media_evidence_foundation.sql'
      ,'0015_editor_handoff_returned_media_intake_foundation.sql'
      ,'0016_returned_editor_review_final_source_decision_foundation.sql'
      ,'0017_publication_delivery_entitlement_foundation.sql'
      ,'0018_temporary_download_center_external_sharing_foundation.sql'
      ,'0019_temporary_download_center_access_credential_gateway_foundation.sql'
      ,'0020_disposable_delivery_surface_local_fixture_foundation.sql'
      ,'0021_provider_neutral_file_backed_disposable_delivery_foundation.sql'
      ,'0022_organization_records_dashboard_audited_export_foundation.sql'
      ,'0023_runtime_intake_reconciliation_commands.sql'
      ,'0024_operations_home_scheduling_assignment_console.sql'
    ]);
  });

  const exactTableNames = [
    'development_sessions',
    'identities',
    'membership_permission_sets',
    'memberships',
    'organizations',
    'people',
    'permission_set_permissions',
    'permission_sets',
    'permissions'
  ].sort();

  for (const [env, pool] of Object.entries({ test: poolTest })) {
    describe(`Catalog Assertions (${env})`, () => {
      it('2. Exact medialab_core schema and owner', async () => {
        const resSchema = await pool.query(`
          SELECT nspname, pg_get_userbyid(nspowner) as owner 
          FROM pg_namespace WHERE nspname = 'medialab_core'
        `);
        expect(resSchema.rows).toHaveLength(1);
        const expectedOwner = env === 'test' ? 'medialab_p02m16a_test_owner' : 'medialab_p02m04a_owner';
        expect(resSchema.rows[0].owner).toBe(expectedOwner);
      });

      it('3. Original nine identity/tenancy table names and owners remain present', async () => {
        const resTables = await pool.query(`
          SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'medialab_core' ORDER BY tablename
        `);
        const tables = resTables.rows.map(r => r.tablename);
        for (const table of exactTableNames) {
          expect(tables).toContain(table);
        }

        const expectedOwner = env === 'test' ? 'medialab_p02m16a_test_owner' : 'medialab_p02m04a_owner';
        for (const row of resTables.rows) {
          expect(row.tableowner).toBe(expectedOwner);
        }
      });

      it('4. Exact released and additive non-table object inventory', async () => {
        const resViews = await pool.query(`SELECT viewname FROM pg_views WHERE schemaname = 'medialab_core'`);
        expect(resViews.rows).toHaveLength(0);
        
        const resMatViews = await pool.query(`SELECT matviewname FROM pg_matviews WHERE schemaname = 'medialab_core'`);
        expect(resMatViews.rows).toHaveLength(0);

        const resSeqs = await pool.query(`SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'medialab_core'`);
        expect(resSeqs.rows).toHaveLength(0);

        const resRoutines = await pool.query(`
          SELECT routine_name, routine_type
          FROM information_schema.routines
          WHERE routine_schema = 'medialab_core'
          ORDER BY routine_name
        `);
        expect(resRoutines.rows).toEqual(
          [...EXACT_ROUTINE_NAMES].sort().map((routine_name) => ({ routine_name, routine_type: 'FUNCTION' }))
        );

        const resTriggers = await pool.query(`
          SELECT
            t.tgname AS trigger_name,
            c.relname AS table_name,
            p.proname AS function_name
          FROM pg_trigger t
          JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_proc p ON p.oid = t.tgfoid
          WHERE NOT t.tgisinternal
            AND n.nspname = 'medialab_core'
          ORDER BY c.relname, t.tgname
        `);
        expect(resTriggers.rows).toEqual(EXACT_TRIGGERS);
      });

      it('5. Exact column definitions', async () => {
        const resCols = await pool.query(`
          SELECT table_name, column_name, data_type, column_default, is_nullable
          FROM information_schema.columns 
          WHERE table_schema = 'medialab_core'
        `);
        
        const cols = resCols.rows;
        
        // Build expected columns map based on schema explicitly
        const expectedMap = {
          'people': [
            { col: 'id', type: 'uuid', nullable: 'NO', def: null },
            { col: 'display_name', type: 'text', nullable: 'NO', def: null },
            { col: 'email', type: 'text', nullable: 'YES', def: null },
            { col: 'title', type: 'text', nullable: 'YES', def: null },
            { col: 'created_at', type: 'timestamp with time zone', nullable: 'NO', def: 'clock_timestamp()' },
            { col: 'updated_at', type: 'timestamp with time zone', nullable: 'NO', def: 'clock_timestamp()' }
          ],
          'identities': [
            { col: 'id', type: 'uuid', nullable: 'NO', def: null },
            { col: 'person_id', type: 'uuid', nullable: 'NO', def: null },
            { col: 'provider', type: 'text', nullable: 'NO', def: null },
            { col: 'provider_subject', type: 'text', nullable: 'NO', def: null },
            { col: 'status', type: 'text', nullable: 'NO', def: "'ACTIVE'::text" },
            { col: 'email_verified_at', type: 'timestamp with time zone', nullable: 'NO', def: null },
            { col: 'created_at', type: 'timestamp with time zone', nullable: 'NO', def: 'clock_timestamp()' }
          ],
          'organizations': [
            { col: 'id', type: 'uuid', nullable: 'NO', def: null },
            { col: 'name', type: 'text', nullable: 'NO', def: null },
            { col: 'created_at', type: 'timestamp with time zone', nullable: 'NO', def: 'clock_timestamp()' },
            { col: 'updated_at', type: 'timestamp with time zone', nullable: 'NO', def: 'clock_timestamp()' }
          ],
          'memberships': [
            { col: 'id', type: 'uuid', nullable: 'NO', def: null },
            { col: 'organization_id', type: 'uuid', nullable: 'NO', def: null },
            { col: 'person_id', type: 'uuid', nullable: 'NO', def: null },
            { col: 'is_organization_admin', type: 'boolean', nullable: 'NO', def: 'false' },
            { col: 'status', type: 'text', nullable: 'NO', def: null },
            { col: 'activated_at', type: 'timestamp with time zone', nullable: 'YES', def: null },
            { col: 'suspended_at', type: 'timestamp with time zone', nullable: 'YES', def: null },
            { col: 'suspension_reason', type: 'text', nullable: 'YES', def: null },
            { col: 'removed_at', type: 'timestamp with time zone', nullable: 'YES', def: null },
            { col: 'created_at', type: 'timestamp with time zone', nullable: 'NO', def: 'clock_timestamp()' },
            { col: 'updated_at', type: 'timestamp with time zone', nullable: 'NO', def: 'clock_timestamp()' }
          ],
          'permissions': [
            { col: 'id', type: 'uuid', nullable: 'NO', def: null },
            { col: 'code', type: 'text', nullable: 'NO', def: null },
            { col: 'description', type: 'text', nullable: 'NO', def: null },
            { col: 'is_active', type: 'boolean', nullable: 'NO', def: 'true' },
            { col: 'created_at', type: 'timestamp with time zone', nullable: 'NO', def: 'clock_timestamp()' }
          ],
          'permission_sets': [
            { col: 'id', type: 'uuid', nullable: 'NO', def: null },
            { col: 'organization_id', type: 'uuid', nullable: 'NO', def: null },
            { col: 'name', type: 'text', nullable: 'NO', def: null },
            { col: 'is_member_specific', type: 'boolean', nullable: 'NO', def: 'false' },
            { col: 'retired_at', type: 'timestamp with time zone', nullable: 'YES', def: null },
            { col: 'created_at', type: 'timestamp with time zone', nullable: 'NO', def: 'clock_timestamp()' },
            { col: 'updated_at', type: 'timestamp with time zone', nullable: 'NO', def: 'clock_timestamp()' }
          ],
          'permission_set_permissions': [
            { col: 'permission_set_id', type: 'uuid', nullable: 'NO', def: null },
            { col: 'permission_id', type: 'uuid', nullable: 'NO', def: null },
            { col: 'created_at', type: 'timestamp with time zone', nullable: 'NO', def: 'clock_timestamp()' }
          ],
          'membership_permission_sets': [
            { col: 'organization_id', type: 'uuid', nullable: 'NO', def: null },
            { col: 'membership_id', type: 'uuid', nullable: 'NO', def: null },
            { col: 'permission_set_id', type: 'uuid', nullable: 'NO', def: null },
            { col: 'created_at', type: 'timestamp with time zone', nullable: 'NO', def: 'clock_timestamp()' }
          ],
          'development_sessions': [
            { col: 'id', type: 'uuid', nullable: 'NO', def: null },
            { col: 'identity_id', type: 'uuid', nullable: 'NO', def: null },
            { col: 'token_sha256', type: 'text', nullable: 'NO', def: null },
            { col: 'issued_at', type: 'timestamp with time zone', nullable: 'NO', def: 'clock_timestamp()' },
            { col: 'expires_at', type: 'timestamp with time zone', nullable: 'NO', def: null },
            { col: 'revoked_at', type: 'timestamp with time zone', nullable: 'YES', def: null }
          ]
        };

        for (const [tableName, expectedCols] of Object.entries(expectedMap)) {
          const actualCols = cols.filter(c => c.table_name === tableName);
          expect(actualCols).toHaveLength(expectedCols.length);
          for (const expected of expectedCols) {
            const actual = actualCols.find(c => c.column_name === expected.col);
            expect(actual).toBeDefined();
            expect(actual!.data_type).toBe(expected.type);
            expect(actual!.is_nullable).toBe(expected.nullable);
            if (expected.def) {
              expect(actual!.column_default).toBe(expected.def);
            } else {
              expect(actual!.column_default).toBeNull();
            }
          }
        }
      });

      it('6. Primary keys, unique, checks, foreign keys', async () => {
        const resConstraints = await pool.query(`
          SELECT tc.table_name, tc.constraint_name, tc.constraint_type
          FROM information_schema.table_constraints tc
          WHERE tc.table_schema = 'medialab_core'
        `);
        const constraints = resConstraints.rows;
        
        // Every table must have a primary key
        for (const tableName of exactTableNames) {
          const hasPk = constraints.some(c => c.table_name === tableName && c.constraint_type === 'PRIMARY KEY');
          expect(hasPk).toBeTruthy();
        }

        // Checks explicitly
        const checks = constraints.filter(c => c.constraint_type === 'CHECK');
        expect(checks.length).toBeGreaterThan(0);

        const resFks = await pool.query(`
          SELECT tc.table_name, tc.constraint_name, kcu.column_name, ccu.table_name AS referenced_table_name, ccu.column_name AS referenced_column_name, rc.update_rule, rc.delete_rule 
          FROM information_schema.referential_constraints rc
          JOIN information_schema.table_constraints tc ON rc.constraint_name = tc.constraint_name
          JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
          JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = rc.unique_constraint_name
          WHERE tc.table_schema = 'medialab_core'
        `);
        expect(resFks.rows.length).toBeGreaterThan(0);
        for (const fk of resFks.rows) {
          expect(fk.delete_rule).toBe('RESTRICT');
        }
      }, 30_000);

      it('7. Privilege Assertions', async () => {
        // Assume using a standard low privilege app user for the dev db assertions
        // The dev db should have specific app roles. 
        // We will assert PUBLIC role privileges as requested.
        const resPrivs = await pool.query(`
          SELECT has_schema_privilege('public', 'medialab_core', 'USAGE') as usg,
                 has_schema_privilege('public', 'medialab_core', 'CREATE') as crt
        `);
        expect(resPrivs.rows[0].usg).toBe(false);
        expect(resPrivs.rows[0].crt).toBe(false);

        const checkPrivs = async (priv: string) => {
          for (const table of exactTableNames) {
            const p = await pool.query(`SELECT has_table_privilege('public', 'medialab_core.${table}', $1) as sel`, [priv]);
            if (p.rows[0].sel !== false) {
               throw new Error(`Table ${table} has PUBLIC ${priv} = true`);
            }
          }
        };

        await checkPrivs('SELECT');
        await checkPrivs('INSERT');
        await checkPrivs('UPDATE');
        await checkPrivs('DELETE');
        await checkPrivs('TRUNCATE');
        await checkPrivs('REFERENCES');
        await checkPrivs('TRIGGER');
        await checkPrivs('MAINTAIN');
      });
    });
  }

  describe('Domain Rules via Transactions', () => {
    let client: pkg.PoolClient;
    beforeAll(async () => {
      client = await poolTest.connect();
    });
    afterAll(() => {
      client.release();
    });

    async function expectDbError(sql: string, params: any[] = []) {
      await client.query('SAVEPOINT sp_test');
      await expect(client.query(sql, params)).rejects.toThrow();
      await client.query('ROLLBACK TO sp_test');
    }

    // Helper to wrap transactions safely
    async function runInTransaction(fn: () => Promise<void>) {
      await client.query('BEGIN');
      try {
        await fn();
      } finally {
        await client.query('ROLLBACK');
      }
    }

    it('8. People domain constraints', async () => {
      await runInTransaction(async () => {
        const pId = crypto.randomUUID();
        // person insertion without an identity succeeds;
        await client.query(`INSERT INTO medialab_core.people (id, display_name, email) VALUES ($1, 'Test', 'test@test.com')`, [pId]);
        
        const errId = crypto.randomUUID();
        // uppercase email is rejected;
        await expectDbError(`INSERT INTO medialab_core.people (id, display_name, email) VALUES ($1, 'T', 'Test@test.com')`, [errId]);
        // leading/trailing whitespace email is rejected;
        await expectDbError(`INSERT INTO medialab_core.people (id, display_name, email) VALUES ($1, 'T', ' test@test.com ')`, [errId]);
        // missing @ is rejected;
        await expectDbError(`INSERT INTO medialab_core.people (id, display_name, email) VALUES ($1, 'T', 'testtest.com')`, [errId]);
        // multiple @ characters are rejected;
        await expectDbError(`INSERT INTO medialab_core.people (id, display_name, email) VALUES ($1, 'T', 't@@test.com')`, [errId]);
        // empty local part is rejected;
        await expectDbError(`INSERT INTO medialab_core.people (id, display_name, email) VALUES ($1, 'T', '@test.com')`, [errId]);
        // empty domain part is rejected;
        await expectDbError(`INSERT INTO medialab_core.people (id, display_name, email) VALUES ($1, 'T', 'test@')`, [errId]);
        // duplicate email is rejected;
        await expectDbError(`INSERT INTO medialab_core.people (id, display_name, email) VALUES ($1, 'T', 'test@test.com')`, [errId]);
        // invalid display-name trimming, emptiness, and length are rejected;
        await expectDbError(`INSERT INTO medialab_core.people (id, display_name, email) VALUES ($1, ' T ', 't2@t.com')`, [errId]);
        await expectDbError(`INSERT INTO medialab_core.people (id, display_name, email) VALUES ($1, '', 't2@t.com')`, [errId]);
        await expectDbError(`INSERT INTO medialab_core.people (id, display_name, email) VALUES ($1, '${'a'.repeat(201)}', 't2@t.com')`, [errId]);
        // invalid title length is rejected
        await expectDbError(`INSERT INTO medialab_core.people (id, display_name, email, title) VALUES ($1, 'T', 't3@t.com', '${'a'.repeat(201)}')`, [errId]);
        // updated_at < created_at is rejected.
        await expectDbError(`INSERT INTO medialab_core.people (id, display_name, email, created_at, updated_at) VALUES ($1, 'T', 't2@t.com', now() + interval '1 hour', now())`, [errId]);
      });
    });

    it('9. Identities constraints', async () => {
      await runInTransaction(async () => {
        const pId = crypto.randomUUID();
        const pId2 = crypto.randomUUID();
        const iId1 = crypto.randomUUID();
        await client.query(`INSERT INTO medialab_core.people (id, display_name, email) VALUES ($1, 'T', 't1@t.com'), ($2, 'T2', 't2@t.com')`, [pId, pId2]);

        await client.query(`INSERT INTO medialab_core.identities (id, person_id, provider, provider_subject, email_verified_at) VALUES ($1, $2, 'LOCAL_DEVELOPMENT', 'sub1', now())`, [iId1, pId]);
        
        const errId = crypto.randomUUID();
        // duplicate (provider, provider_subject) is rejected;
        await expectDbError(`INSERT INTO medialab_core.identities (id, person_id, provider, provider_subject, email_verified_at) VALUES ($1, $2, 'LOCAL_DEVELOPMENT', 'sub1', now())`, [errId, pId2]);
        // duplicate (person_id, provider) is rejected;
        await expectDbError(`INSERT INTO medialab_core.identities (id, person_id, provider, provider_subject, email_verified_at) VALUES ($1, $2, 'LOCAL_DEVELOPMENT', 'sub2', now())`, [errId, pId]);
        // invalid provider is rejected;
        await expectDbError(`INSERT INTO medialab_core.identities (id, person_id, provider, provider_subject, email_verified_at) VALUES ($1, $2, 'BAD', 'sub', now())`, [errId, pId2]);
        // invalid status is rejected;
        await expectDbError(`INSERT INTO medialab_core.identities (id, person_id, provider, provider_subject, status, email_verified_at) VALUES ($1, $2, 'LOCAL_DEVELOPMENT', 'sub', 'BAD', now())`, [errId, pId2]);
        // empty, padded, and oversized provider subject is rejected.
        await expectDbError(`INSERT INTO medialab_core.identities (id, person_id, provider, provider_subject, email_verified_at) VALUES ($1, $2, 'LOCAL_DEVELOPMENT', '', now())`, [errId, pId2]);
        await expectDbError(`INSERT INTO medialab_core.identities (id, person_id, provider, provider_subject, email_verified_at) VALUES ($1, $2, 'LOCAL_DEVELOPMENT', ' sub ', now())`, [errId, pId2]);
        await expectDbError(`INSERT INTO medialab_core.identities (id, person_id, provider, provider_subject, email_verified_at) VALUES ($1, $2, 'LOCAL_DEVELOPMENT', '${'a'.repeat(300)}', now())`, [errId, pId2]);
      });
    });

    it('10. Organizations and permission sets constraints', async () => {
      await runInTransaction(async () => {
        const orgId1 = crypto.randomUUID();
        const orgId2 = crypto.randomUUID();
        
        // invalid organization name rules are rejected;
        await expectDbError(`INSERT INTO medialab_core.organizations (id, name) VALUES ($1, '')`, [orgId1]);
        await expectDbError(`INSERT INTO medialab_core.organizations (id, name) VALUES ($1, ' ')`, [orgId1]);
        await expectDbError(`INSERT INTO medialab_core.organizations (id, name) VALUES ($1, '${'a'.repeat(201)}')`, [orgId1]);
        
        await client.query(`INSERT INTO medialab_core.organizations (id, name) VALUES ($1, 'Org 1'), ($2, 'Org 2')`, [orgId1, orgId2]);

        const psId1 = crypto.randomUUID();
        await client.query(`INSERT INTO medialab_core.permission_sets (id, organization_id, name) VALUES ($1, $2, 'Set 1')`, [psId1, orgId1]);

        // duplicate permission-set name within one organization is rejected;
        await expectDbError(`INSERT INTO medialab_core.permission_sets (id, organization_id, name) VALUES ($1, $2, 'Set 1')`, [crypto.randomUUID(), orgId1]);
        // the same name in different organizations succeeds;
        await client.query(`INSERT INTO medialab_core.permission_sets (id, organization_id, name) VALUES ($1, $2, 'Set 1')`, [crypto.randomUUID(), orgId2]);
        // invalid permission-set name rules are rejected;
        await expectDbError(`INSERT INTO medialab_core.permission_sets (id, organization_id, name) VALUES ($1, $2, '')`, [crypto.randomUUID(), orgId1]);
        await expectDbError(`INSERT INTO medialab_core.permission_sets (id, organization_id, name) VALUES ($1, $2, ' ')`, [crypto.randomUUID(), orgId1]);
        // updated_at < created_at is rejected.
        await expectDbError(`INSERT INTO medialab_core.permission_sets (id, organization_id, name, created_at, updated_at) VALUES ($1, $2, 'Set x', now() + interval '1 day', now())`, [crypto.randomUUID(), orgId1]);
      });
    });

    it('11. Memberships constraints', async () => {
      await runInTransaction(async () => {
        const pId = crypto.randomUUID();
        const oId = crypto.randomUUID();
        await client.query(`INSERT INTO medialab_core.people (id, display_name, email) VALUES ($1, 'T', 't1@t.com')`, [pId]);
        await client.query(`INSERT INTO medialab_core.organizations (id, name) VALUES ($1, 'O')`, [oId]);

        const mId = crypto.randomUUID();
        
        // pending with any activation/suspension/removal value is rejected;
        await expectDbError(`INSERT INTO medialab_core.memberships (id, organization_id, person_id, status, activated_at) VALUES ($1, $2, $3, 'PENDING_ACTIVATION', now())`, [mId, oId, pId]);
        
        await client.query(`INSERT INTO medialab_core.memberships (id, organization_id, person_id, status) VALUES ($1, $2, $3, 'PENDING_ACTIVATION')`, [mId, oId, pId]);

        // active without activation is rejected;
        await expectDbError(`UPDATE medialab_core.memberships SET status = 'ACTIVE' WHERE id = $1`, [mId]);
        // active with suspension data is rejected;
        await expectDbError(`UPDATE medialab_core.memberships SET status = 'ACTIVE', activated_at = now(), suspended_at = now(), suspension_reason = 'r' WHERE id = $1`, [mId]);
        // active with removal timestamp is rejected;
        await expectDbError(`UPDATE medialab_core.memberships SET status = 'ACTIVE', activated_at = now(), removed_at = now() WHERE id = $1`, [mId]);
        
        await client.query(`UPDATE medialab_core.memberships SET status = 'ACTIVE', activated_at = now() WHERE id = $1`, [mId]);

        // suspended without activation is rejected;
        await expectDbError(`UPDATE medialab_core.memberships SET status = 'SUSPENDED', suspended_at = now(), suspension_reason = 'r', activated_at = NULL WHERE id = $1`, [mId]);
        // suspended without suspension timestamp is rejected;
        await expectDbError(`UPDATE medialab_core.memberships SET status = 'SUSPENDED', suspension_reason = 'r' WHERE id = $1`, [mId]);
        // suspended without reason is rejected;
        await expectDbError(`UPDATE medialab_core.memberships SET status = 'SUSPENDED', suspended_at = now(), suspension_reason = NULL WHERE id = $1`, [mId]);
        // suspended with removal timestamp is rejected;
        await expectDbError(`UPDATE medialab_core.memberships SET status = 'SUSPENDED', suspended_at = now(), suspension_reason = 'r', removed_at = now() WHERE id = $1`, [mId]);
        // invalid suspension-reason trimming, emptiness, and length are rejected;
        await expectDbError(`UPDATE medialab_core.memberships SET status = 'SUSPENDED', suspended_at = now(), suspension_reason = ' ' WHERE id = $1`, [mId]);

        await client.query(`UPDATE medialab_core.memberships SET status = 'SUSPENDED', suspended_at = now(), suspension_reason = 'r' WHERE id = $1`, [mId]);

        // removed without removal timestamp is rejected;
        await expectDbError(`UPDATE medialab_core.memberships SET status = 'REMOVED', removed_at = NULL WHERE id = $1`, [mId]);
        
        await client.query(`UPDATE medialab_core.memberships SET status = 'REMOVED', removed_at = now() WHERE id = $1`, [mId]);

        // invalid status is rejected;
        await expectDbError(`UPDATE medialab_core.memberships SET status = 'BAD' WHERE id = $1`, [mId]);

        // duplicate organization/person membership is rejected;
        await expectDbError(`INSERT INTO medialab_core.memberships (id, organization_id, person_id, status) VALUES ($1, $2, $3, 'PENDING_ACTIVATION')`, [crypto.randomUUID(), oId, pId]);

        // updated_at < created_at is rejected.
        await expectDbError(`UPDATE medialab_core.memberships SET updated_at = created_at - interval '1 hour' WHERE id = $1`, [mId]);
      });
    });

    it('12. Permissions and links constraints', async () => {
      await runInTransaction(async () => {
        const permId1 = crypto.randomUUID();
        // valid permission code succeeds;
        await client.query(`INSERT INTO medialab_core.permissions (id, code, description) VALUES ($1, 'a.b', 'Desc')`, [permId1]);
        // uppercase code is rejected;
        await expectDbError(`INSERT INTO medialab_core.permissions (id, code, description) VALUES ($1, 'A.b', 'Desc')`, [crypto.randomUUID()]);
        // code without a dot is rejected;
        await expectDbError(`INSERT INTO medialab_core.permissions (id, code, description) VALUES ($1, 'a', 'Desc')`, [crypto.randomUUID()]);
        // invalid segment forms are rejected;
        await expectDbError(`INSERT INTO medialab_core.permissions (id, code, description) VALUES ($1, 'a..b', 'Desc')`, [crypto.randomUUID()]);
        // invalid description trimming, emptiness, and length are rejected;
        await expectDbError(`INSERT INTO medialab_core.permissions (id, code, description) VALUES ($1, 'c.d', ' ')`, [crypto.randomUUID()]);
        await expectDbError(`INSERT INTO medialab_core.permissions (id, code, description) VALUES ($1, 'c.d', '${'a'.repeat(501)}')`, [crypto.randomUUID()]);
        // duplicate permission code is rejected;
        await expectDbError(`INSERT INTO medialab_core.permissions (id, code, description) VALUES ($1, 'a.b', 'Desc 2')`, [crypto.randomUUID()]);

        const orgId = crypto.randomUUID();
        const pId = crypto.randomUUID();
        await client.query(`INSERT INTO medialab_core.organizations (id, name) VALUES ($1, 'O')`, [orgId]);
        await client.query(`INSERT INTO medialab_core.people (id, display_name, email) VALUES ($1, 'T', 't1@t.com')`, [pId]);
        
        const psId = crypto.randomUUID();
        await client.query(`INSERT INTO medialab_core.permission_sets (id, organization_id, name) VALUES ($1, $2, 'Set 1')`, [psId, orgId]);

        // permission_set_permissions link
        await client.query(`INSERT INTO medialab_core.permission_set_permissions (permission_set_id, permission_id) VALUES ($1, $2)`, [psId, permId1]);
        // duplicate permission-set/permission link is rejected;
        await expectDbError(`INSERT INTO medialab_core.permission_set_permissions (permission_set_id, permission_id) VALUES ($1, $2)`, [psId, permId1]);

        const mId = crypto.randomUUID();
        await client.query(`INSERT INTO medialab_core.memberships (id, organization_id, person_id, status) VALUES ($1, $2, $3, 'PENDING_ACTIVATION')`, [mId, orgId, pId]);

        const orgId2 = crypto.randomUUID();
        await client.query(`INSERT INTO medialab_core.organizations (id, name) VALUES ($1, 'O2')`, [orgId2]);
        const mId2 = crypto.randomUUID();
        await client.query(`INSERT INTO medialab_core.memberships (id, organization_id, person_id, status) VALUES ($1, $2, $3, 'PENDING_ACTIVATION')`, [mId2, orgId2, pId]);

        // matching-organization assignment succeeds.
        await client.query(`INSERT INTO medialab_core.membership_permission_sets (organization_id, membership_id, permission_set_id) VALUES ($1, $2, $3)`, [orgId, mId, psId]);
        
        // duplicate membership/permission-set link is rejected;
        await expectDbError(`INSERT INTO medialab_core.membership_permission_sets (organization_id, membership_id, permission_set_id) VALUES ($1, $2, $3)`, [orgId, mId, psId]);

        // cross-organization assignment is rejected by the composite foreign keys;
        await expectDbError(`INSERT INTO medialab_core.membership_permission_sets (organization_id, membership_id, permission_set_id) VALUES ($1, $2, $3)`, [orgId, mId2, psId]);
        await expectDbError(`INSERT INTO medialab_core.membership_permission_sets (organization_id, membership_id, permission_set_id) VALUES ($1, $2, $3)`, [orgId2, mId, psId]);
      });
    });

    it('13. Development sessions constraints', async () => {
      await runInTransaction(async () => {
        const pId = crypto.randomUUID();
        const iId = crypto.randomUUID();
        await client.query(`INSERT INTO medialab_core.people (id, display_name, email) VALUES ($1, 'T', 't1@t.com')`, [pId]);
        await client.query(`INSERT INTO medialab_core.identities (id, person_id, provider, provider_subject, email_verified_at) VALUES ($1, $2, 'LOCAL_DEVELOPMENT', 'sub', now())`, [iId, pId]);

        const sId = crypto.randomUUID();
        const validHash = 'a'.repeat(64);
        // valid session succeeds;
        await client.query(`INSERT INTO medialab_core.development_sessions (id, identity_id, token_sha256, issued_at, expires_at) VALUES ($1, $2, $3, now(), now() + interval '1 hour')`, [sId, iId, validHash]);

        const errId = crypto.randomUUID();
        // short hash is rejected;
        await expectDbError(`INSERT INTO medialab_core.development_sessions (id, identity_id, token_sha256, issued_at, expires_at) VALUES ($1, $2, $3, now(), now() + interval '1 hour')`, [errId, iId, 'a'.repeat(63)]);
        // uppercase hash is rejected;
        await expectDbError(`INSERT INTO medialab_core.development_sessions (id, identity_id, token_sha256, issued_at, expires_at) VALUES ($1, $2, $3, now(), now() + interval '1 hour')`, [errId, iId, 'A'.repeat(64)]);
        // non-hex hash is rejected;
        await expectDbError(`INSERT INTO medialab_core.development_sessions (id, identity_id, token_sha256, issued_at, expires_at) VALUES ($1, $2, $3, now(), now() + interval '1 hour')`, [errId, iId, 'g'.repeat(64)]);
        // duplicate hash is rejected;
        await expectDbError(`INSERT INTO medialab_core.development_sessions (id, identity_id, token_sha256, issued_at, expires_at) VALUES ($1, $2, $3, now(), now() + interval '1 hour')`, [errId, iId, validHash]);
        // expires_at = issued_at is rejected;
        await expectDbError(`INSERT INTO medialab_core.development_sessions (id, identity_id, token_sha256, issued_at, expires_at) VALUES ($1, $2, $3, now(), now())`, [errId, iId, 'b'.repeat(64)]);
        // expires_at < issued_at is rejected;
        await expectDbError(`INSERT INTO medialab_core.development_sessions (id, identity_id, token_sha256, issued_at, expires_at) VALUES ($1, $2, $3, now(), now() - interval '1 hour')`, [errId, iId, 'b'.repeat(64)]);
        // revoked_at < issued_at is rejected;
        await expectDbError(`INSERT INTO medialab_core.development_sessions (id, identity_id, token_sha256, issued_at, expires_at, revoked_at) VALUES ($1, $2, $3, now(), now() + interval '1 hour', now() - interval '1 hour')`, [errId, iId, 'b'.repeat(64)]);
        // valid revoked timestamp succeeds.
        await client.query(`UPDATE medialab_core.development_sessions SET revoked_at = now() WHERE id = $1`, [sId]);
      });
    });

  });

  it('14. Domain table row count assertions in both databases', async () => {
    const expectedCounts: Record<string, number> = {
      organizations: 1,
      people: 3,
      identities: 2,
      memberships: 3,
      permissions: 38,
      permission_sets: 1,
      permission_set_permissions: 38,
      membership_permission_sets: 1,
      development_sessions: 1
    };

    for (const [env, pool] of Object.entries({ test: poolTest })) {
      for (const table of exactTableNames) {
        const res = await pool.query(`SELECT count(*)::int as count FROM medialab_core.${table}`);
        const cnt = res.rows[0].count;
        const exp = expectedCounts[table] || 0;
        expect(cnt, `Table ${table} in ${env} has ${cnt} rows, expected exact ${exp}`).toBe(exp);
      }
    }
  });
});
