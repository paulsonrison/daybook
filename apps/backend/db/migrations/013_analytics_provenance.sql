-- Older/backfilled deliveries deliberately retain unknown procurement costs.
ALTER TABLE daybook.delivery_logs
 ADD COLUMN procurement_unit_paise bigint CHECK(procurement_unit_paise>=0),
 ADD COLUMN procurement_basis text NOT NULL DEFAULT 'UNRECORDED' CHECK(procurement_basis IN('UNRECORDED','PUBLICATION_AT_PREPARATION')),
 ADD COLUMN procurement_recorded_at timestamptz,
 ADD CONSTRAINT delivery_procurement_provenance CHECK(
   (procurement_basis='UNRECORDED' AND procurement_unit_paise IS NULL AND procurement_recorded_at IS NULL)
   OR (procurement_basis='PUBLICATION_AT_PREPARATION' AND procurement_unit_paise IS NOT NULL AND procurement_recorded_at IS NOT NULL)
 );

CREATE FUNCTION daybook.guard_delivery_procurement_snapshot() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,daybook AS $$
BEGIN
 IF (NEW.procurement_unit_paise,NEW.procurement_basis,NEW.procurement_recorded_at)
    IS DISTINCT FROM (OLD.procurement_unit_paise,OLD.procurement_basis,OLD.procurement_recorded_at)
 THEN RAISE EXCEPTION 'Recorded delivery procurement estimates are immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER delivery_procurement_finality BEFORE UPDATE ON daybook.delivery_logs
FOR EACH ROW EXECUTE FUNCTION daybook.guard_delivery_procurement_snapshot();

CREATE INDEX ledger_entries_reporting ON daybook.ledger_entries(agency_id,entry_date) INCLUDE(kind,amount_paise);
CREATE INDEX payments_reporting ON daybook.payments(agency_id,posting_date) WHERE status='CONFIRMED';
CREATE INDEX merchandise_charges_reporting ON daybook.merchandise_charges(agency_id,charge_date);
CREATE INDEX advertiser_invoices_reporting ON daybook.advertiser_invoices(agency_id,issued_date) INCLUDE(subtotal_paise,tax_paise);
CREATE INDEX audit_resident_registration ON daybook.audit_events(agency_id,entity_id,created_at) WHERE entity_type='resident' AND action='resident.created';
