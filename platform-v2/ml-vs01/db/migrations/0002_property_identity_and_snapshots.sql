CREATE TABLE medialab_core.properties (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES medialab_core.organizations(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    archived_at timestamptz NULL,
    CONSTRAINT properties_id_org_key UNIQUE (id, organization_id),
    CONSTRAINT properties_archived_at_check CHECK (archived_at IS NULL OR archived_at >= created_at)
);
REVOKE ALL ON TABLE medialab_core.properties FROM PUBLIC;

CREATE TABLE medialab_core.property_snapshots (
    id uuid PRIMARY KEY,
    property_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    address_line_1 text NOT NULL,
    address_line_2 text NULL,
    locality text NOT NULL,
    administrative_area text NOT NULL,
    postal_code text NOT NULL,
    country_code char(2) NOT NULL DEFAULT 'US',
    reported_square_feet integer NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (property_id, organization_id) REFERENCES medialab_core.properties(id, organization_id) ON DELETE RESTRICT,
    CONSTRAINT property_snapshots_reported_square_feet_check CHECK (reported_square_feet IS NULL OR reported_square_feet > 0),
    CONSTRAINT property_snapshots_address_line_1_check CHECK (trim(address_line_1) <> ''),
    CONSTRAINT property_snapshots_locality_check CHECK (trim(locality) <> ''),
    CONSTRAINT property_snapshots_administrative_area_check CHECK (trim(administrative_area) <> ''),
    CONSTRAINT property_snapshots_postal_code_check CHECK (trim(postal_code) <> ''),
    CONSTRAINT property_snapshots_country_code_check CHECK (country_code ~ '^[A-Z]{2}$')
);
REVOKE ALL ON TABLE medialab_core.property_snapshots FROM PUBLIC;

CREATE OR REPLACE FUNCTION medialab_core.reject_property_snapshot_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'property_snapshots rows are immutable: UPDATE and DELETE are rejected'
        USING ERRCODE = '23502';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER property_snapshots_immutability_guard
    BEFORE UPDATE OR DELETE ON medialab_core.property_snapshots
    FOR EACH ROW
    EXECUTE FUNCTION medialab_core.reject_property_snapshot_mutation();
