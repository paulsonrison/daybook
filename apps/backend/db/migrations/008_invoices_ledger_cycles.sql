CREATE TABLE daybook.billing_policies (
 agency_id uuid PRIMARY KEY REFERENCES daybook.agencies(id),tax_treatment text NOT NULL DEFAULT 'UNCONFIGURED' CHECK(tax_treatment IN('UNCONFIGURED','NO_TAX','CONFIGURED')),default_due_days integer NOT NULL DEFAULT 7 CHECK(default_due_days BETWEEN 0 AND 365),auto_issue boolean NOT NULL DEFAULT false,version integer NOT NULL DEFAULT 1
);
CREATE TABLE daybook.billing_cycles (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL REFERENCES daybook.agencies(id),cycle_month date NOT NULL,summary jsonb NOT NULL,closed_at timestamptz NOT NULL DEFAULT now(),closed_by uuid,
 CHECK(extract(day FROM cycle_month)=1),UNIQUE(agency_id,id),UNIQUE(agency_id,cycle_month),FOREIGN KEY(agency_id,closed_by) REFERENCES daybook.agents(agency_id,id)
);
CREATE TABLE daybook.invoices (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,resident_id uuid NOT NULL,code text NOT NULL,resident_name text NOT NULL,resident_code text NOT NULL,address text NOT NULL,route_id uuid NOT NULL,route_name text NOT NULL,drop_order integer NOT NULL,
 period_mode text NOT NULL CHECK(period_mode IN('MONTHLY','WEEKLY','CUSTOM','SELECTED_MONTHS')),periods jsonb NOT NULL,issued_date date NOT NULL,due_date date NOT NULL,current_total_paise bigint NOT NULL CHECK(current_total_paise>=0),state text NOT NULL CHECK(state IN('DRAFT','ISSUED')),version integer NOT NULL DEFAULT 1,note text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(agency_id,id),UNIQUE(agency_id,resident_id,id),UNIQUE(agency_id,code),FOREIGN KEY(agency_id,resident_id) REFERENCES daybook.residents(agency_id,id),FOREIGN KEY(agency_id,route_id) REFERENCES daybook.routes(agency_id,id)
);
CREATE TABLE daybook.invoice_revisions (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,invoice_id uuid NOT NULL,version integer NOT NULL,payload jsonb NOT NULL,created_by uuid,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(agency_id,id),UNIQUE(agency_id,invoice_id,version),FOREIGN KEY(agency_id,invoice_id) REFERENCES daybook.invoices(agency_id,id),FOREIGN KEY(agency_id,created_by) REFERENCES daybook.agents(agency_id,id)
);
CREATE TABLE daybook.invoice_lines (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,invoice_id uuid NOT NULL,revision integer NOT NULL,line_key text NOT NULL,kind text NOT NULL CHECK(kind IN('DELIVERY','MERCHANDISE','ADJUSTMENT')),description text NOT NULL,quantity integer NOT NULL CHECK(quantity>=0),source_quantity integer NOT NULL CHECK(source_quantity>=0),unit_paise bigint NOT NULL CHECK(unit_paise>=0),source_unit_paise bigint NOT NULL CHECK(source_unit_paise>=0),amount_paise bigint NOT NULL,correction_reason text,
 UNIQUE(agency_id,id),UNIQUE(agency_id,invoice_id,revision,line_key),FOREIGN KEY(agency_id,invoice_id,revision) REFERENCES daybook.invoice_revisions(agency_id,invoice_id,version)
);
CREATE TABLE daybook.ledger_entries (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,resident_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN('INVOICE','INVOICE_REVISION','PAYMENT','REFUND','ADJUSTMENT','OPENING','DEPOSIT_OFFSET','MERCHANDISE_CASH','MERCHANDISE_CASH_PAYMENT')),source_key text NOT NULL,amount_paise bigint NOT NULL CHECK(amount_paise<>0 AND amount_paise<>'-9223372036854775808'::bigint),entry_date date NOT NULL,due_date date NOT NULL,description text NOT NULL,invoice_id uuid,reference_invoice_id uuid,actor_id uuid,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(kind<>'PAYMENT' OR amount_paise<0),CHECK(kind<>'REFUND' OR amount_paise>0),CHECK(kind<>'INVOICE' OR(amount_paise>0 AND invoice_id IS NOT NULL)),CHECK(kind<>'INVOICE_REVISION' OR invoice_id IS NOT NULL),
 CHECK(invoice_id IS NULL OR kind IN('INVOICE','INVOICE_REVISION')),CHECK(kind<>'MERCHANDISE_CASH' OR amount_paise>0),CHECK(kind NOT IN('MERCHANDISE_CASH_PAYMENT','DEPOSIT_OFFSET') OR amount_paise<0),
 UNIQUE(agency_id,id),UNIQUE(agency_id,source_key),FOREIGN KEY(agency_id,resident_id) REFERENCES daybook.residents(agency_id,id),FOREIGN KEY(agency_id,resident_id,invoice_id) REFERENCES daybook.invoices(agency_id,resident_id,id),FOREIGN KEY(agency_id,resident_id,reference_invoice_id) REFERENCES daybook.invoices(agency_id,resident_id,id),FOREIGN KEY(agency_id,actor_id) REFERENCES daybook.agents(agency_id,id)
);
CREATE INDEX ledger_entries_account ON daybook.ledger_entries(agency_id,resident_id,entry_date,due_date);
CREATE UNIQUE INDEX ledger_one_initial_invoice ON daybook.ledger_entries(agency_id,invoice_id) WHERE kind='INVOICE';
CREATE TABLE daybook.ledger_settlements (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,debit_entry_id uuid NOT NULL,credit_entry_id uuid NOT NULL,amount_paise bigint NOT NULL CHECK(amount_paise>0),created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(debit_entry_id<>credit_entry_id),UNIQUE(agency_id,id),FOREIGN KEY(agency_id,debit_entry_id) REFERENCES daybook.ledger_entries(agency_id,id),FOREIGN KEY(agency_id,credit_entry_id) REFERENCES daybook.ledger_entries(agency_id,id)
);
CREATE INDEX ledger_settlements_debit ON daybook.ledger_settlements(agency_id,debit_entry_id);
CREATE INDEX ledger_settlements_credit ON daybook.ledger_settlements(agency_id,credit_entry_id);
ALTER TABLE daybook.delivery_logs ADD CONSTRAINT delivery_log_resident_identity UNIQUE(agency_id,resident_id,id);
ALTER TABLE daybook.merchandise_charges ADD CONSTRAINT merchandise_charge_resident_identity UNIQUE(agency_id,resident_id,id);
CREATE TABLE daybook.invoice_delivery_claims (
 agency_id uuid NOT NULL,resident_id uuid NOT NULL,delivery_id uuid NOT NULL,invoice_id uuid NOT NULL,billed_quantity integer NOT NULL CHECK(billed_quantity>=0),billed_unit_paise bigint NOT NULL CHECK(billed_unit_paise>=0),
 PRIMARY KEY(agency_id,delivery_id),FOREIGN KEY(agency_id,resident_id,delivery_id) REFERENCES daybook.delivery_logs(agency_id,resident_id,id),FOREIGN KEY(agency_id,resident_id,invoice_id) REFERENCES daybook.invoices(agency_id,resident_id,id)
);
CREATE TABLE daybook.invoice_merchandise_claims (
 agency_id uuid NOT NULL,resident_id uuid NOT NULL,charge_id uuid NOT NULL,invoice_id uuid NOT NULL,
 PRIMARY KEY(agency_id,charge_id),FOREIGN KEY(agency_id,resident_id,charge_id) REFERENCES daybook.merchandise_charges(agency_id,resident_id,id),FOREIGN KEY(agency_id,resident_id,invoice_id) REFERENCES daybook.invoices(agency_id,resident_id,id)
);
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['billing_policies','billing_cycles','invoices','invoice_revisions','invoice_lines','ledger_entries','ledger_settlements','invoice_delivery_claims','invoice_merchandise_claims'] LOOP
  EXECUTE format('ALTER TABLE daybook.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('ALTER TABLE daybook.%I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('CREATE POLICY tenant_scope ON daybook.%I TO daybook_app USING(agency_id=daybook.current_agency()) WITH CHECK(agency_id=daybook.current_agency())',name);
  EXECUTE format('GRANT SELECT,INSERT ON daybook.%I TO daybook_app',name);
 END LOOP;
END $$;
GRANT UPDATE ON daybook.billing_policies,daybook.invoices TO daybook_app;
GRANT UPDATE(billed_quantity,billed_unit_paise) ON daybook.invoice_delivery_claims TO daybook_app;
CREATE FUNCTION daybook.guard_ledger_post() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,daybook AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('ledger:'||NEW.agency_id::text,0));
 IF EXISTS(SELECT 1 FROM daybook.billing_cycles WHERE agency_id=NEW.agency_id AND cycle_month=date_trunc('month',NEW.entry_date)::date) THEN RAISE EXCEPTION 'Posting period is closed' USING ERRCODE='23514'; END IF;
 IF NEW.kind IN('INVOICE','INVOICE_REVISION') AND daybook.invoice_locked(NEW.invoice_id) THEN RAISE EXCEPTION 'Finalized invoice posting is immutable' USING ERRCODE='23514';END IF;
 RETURN NEW; END $$;
CREATE TRIGGER ledger_open_period BEFORE INSERT ON daybook.ledger_entries FOR EACH ROW EXECUTE FUNCTION daybook.guard_ledger_post();
CREATE FUNCTION daybook.guard_settlement() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,daybook AS $$ DECLARE debit daybook.ledger_entries%ROWTYPE;credit daybook.ledger_entries%ROWTYPE;used_debit numeric;used_credit numeric; BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('ledger:'||NEW.agency_id::text,0));
 SELECT * INTO debit FROM daybook.ledger_entries WHERE agency_id=NEW.agency_id AND id=NEW.debit_entry_id;
 SELECT * INTO credit FROM daybook.ledger_entries WHERE agency_id=NEW.agency_id AND id=NEW.credit_entry_id;
 IF debit.id IS NULL OR credit.id IS NULL OR debit.resident_id<>credit.resident_id OR debit.amount_paise<=0 OR credit.amount_paise>=0 THEN RAISE EXCEPTION 'Invalid debit and credit settlement' USING ERRCODE='23514'; END IF;
 SELECT coalesce(sum(amount_paise),0) INTO used_debit FROM daybook.ledger_settlements WHERE agency_id=NEW.agency_id AND debit_entry_id=debit.id;
 SELECT coalesce(sum(amount_paise),0) INTO used_credit FROM daybook.ledger_settlements WHERE agency_id=NEW.agency_id AND credit_entry_id=credit.id;
 IF used_debit+NEW.amount_paise>debit.amount_paise OR used_credit+NEW.amount_paise>-credit.amount_paise THEN RAISE EXCEPTION 'Settlement exceeds available debit or credit' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER ledger_bounded_settlement BEFORE INSERT ON daybook.ledger_settlements FOR EACH ROW EXECUTE FUNCTION daybook.guard_settlement();
CREATE FUNCTION daybook.invoice_open_paise(invoice_uuid uuid) RETURNS numeric LANGUAGE sql STABLE SET search_path=pg_catalog,daybook AS $$
 SELECT coalesce(sum(e.amount_paise-coalesce((SELECT sum(s.amount_paise) FROM daybook.ledger_settlements s WHERE(s.agency_id,s.debit_entry_id)=(e.agency_id,e.id)),0)),0) FROM daybook.ledger_entries e WHERE e.agency_id=daybook.current_agency() AND e.invoice_id=invoice_uuid AND e.amount_paise>0
$$;
CREATE FUNCTION daybook.invoice_locked(invoice_uuid uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,daybook AS $$
 SELECT coalesce((SELECT state='ISSUED' AND(daybook.invoice_open_paise(id)<=0 OR EXISTS(SELECT 1 FROM daybook.billing_cycles c WHERE c.agency_id=i.agency_id AND c.cycle_month=date_trunc('month',i.issued_date)::date)) FROM daybook.invoices i WHERE i.agency_id=daybook.current_agency() AND i.id=invoice_uuid),false)
$$;
CREATE FUNCTION daybook.guard_invoice_update() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,daybook AS $$ BEGIN
 IF daybook.invoice_locked(OLD.id) THEN RAISE EXCEPTION 'Settled invoice or closed issue period is immutable' USING ERRCODE='23514'; END IF;RETURN NEW;END $$;
CREATE TRIGGER invoice_finality BEFORE UPDATE ON daybook.invoices FOR EACH ROW EXECUTE FUNCTION daybook.guard_invoice_update();
CREATE FUNCTION daybook.guard_invoice_content() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,daybook AS $$ BEGIN
 IF daybook.invoice_locked(NEW.invoice_id) THEN RAISE EXCEPTION 'Finalized invoice content is immutable' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER invoice_line_finality BEFORE INSERT ON daybook.invoice_lines FOR EACH ROW EXECUTE FUNCTION daybook.guard_invoice_content();
CREATE TRIGGER invoice_revision_finality BEFORE INSERT ON daybook.invoice_revisions FOR EACH ROW EXECUTE FUNCTION daybook.guard_invoice_content();
CREATE TRIGGER invoice_claim_finality BEFORE INSERT OR UPDATE ON daybook.invoice_delivery_claims FOR EACH ROW EXECUTE FUNCTION daybook.guard_invoice_content();
CREATE TRIGGER invoice_merchandise_finality BEFORE INSERT ON daybook.invoice_merchandise_claims FOR EACH ROW EXECUTE FUNCTION daybook.guard_invoice_content();
CREATE FUNCTION daybook.guard_delivery_financial() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,daybook AS $$ DECLARE agency uuid;dated date; BEGIN
 IF TG_OP='INSERT' THEN agency:=NEW.agency_id;dated:=NEW.delivery_date;ELSE agency:=OLD.agency_id;dated:=OLD.delivery_date;END IF;
 IF EXISTS(SELECT 1 FROM daybook.billing_cycles WHERE agency_id=agency AND cycle_month=date_trunc('month',dated)::date) THEN RAISE EXCEPTION 'Delivery period is closed' USING ERRCODE='23514';END IF;
 IF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM daybook.invoice_delivery_claims WHERE agency_id=agency AND delivery_id=OLD.id) THEN RAISE EXCEPTION 'Invoiced source cannot be deleted' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' AND (NEW.quantity,NEW.price_paise,NEW.chargeable_quantity,NEW.delivery_date,NEW.resident_id,NEW.publication_id,NEW.subscription_id,NEW.status) IS DISTINCT FROM (OLD.quantity,OLD.price_paise,OLD.chargeable_quantity,OLD.delivery_date,OLD.resident_id,OLD.publication_id,OLD.subscription_id,OLD.status) AND EXISTS(SELECT 1 FROM daybook.invoice_delivery_claims WHERE agency_id=agency AND delivery_id=OLD.id) THEN RAISE EXCEPTION 'Invoiced delivery amounts require a separate financial correction' USING ERRCODE='23514';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;END $$;
CREATE TRIGGER delivery_financial_finality BEFORE INSERT OR UPDATE OR DELETE ON daybook.delivery_logs FOR EACH ROW EXECUTE FUNCTION daybook.guard_delivery_financial();
ALTER TABLE daybook.audit_events ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE daybook.audit_events ADD COLUMN actor_kind text NOT NULL DEFAULT 'AGENT' CHECK(actor_kind IN('AGENT','SYSTEM'));
ALTER TABLE daybook.audit_events ADD CONSTRAINT audit_actor_kind CHECK((actor_kind='AGENT' AND actor_id IS NOT NULL) OR(actor_kind='SYSTEM' AND actor_id IS NULL));
ALTER TABLE daybook.audit_events ADD CONSTRAINT audit_agency_identity FOREIGN KEY(agency_id) REFERENCES daybook.agencies(id);
ALTER TABLE daybook.job_runs ADD COLUMN payload jsonb NOT NULL DEFAULT '{}';
CREATE FUNCTION daybook.guard_invoice_posting_balance() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,daybook AS $$ DECLARE target uuid;header record;posted numeric; BEGIN
 IF TG_TABLE_NAME='invoices' THEN target:=NEW.id;ELSE target:=NEW.invoice_id;END IF;
 IF target IS NULL THEN RETURN NULL;END IF;
 SELECT state,current_total_paise INTO header FROM daybook.invoices WHERE agency_id=NEW.agency_id AND id=target;
 SELECT coalesce(sum(amount_paise),0) INTO posted FROM daybook.ledger_entries WHERE agency_id=NEW.agency_id AND invoice_id=target;
 IF(header.state='ISSUED' AND posted<>header.current_total_paise) OR(header.state='DRAFT' AND posted<>0) THEN RAISE EXCEPTION 'Invoice and receivable postings do not balance' USING ERRCODE='23514';END IF;RETURN NULL;END $$;
CREATE CONSTRAINT TRIGGER invoice_posting_balance AFTER INSERT OR UPDATE ON daybook.invoices DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION daybook.guard_invoice_posting_balance();
CREATE CONSTRAINT TRIGGER ledger_invoice_balance AFTER INSERT ON daybook.ledger_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION daybook.guard_invoice_posting_balance();
INSERT INTO daybook.ledger_entries(id,agency_id,resident_id,kind,source_key,amount_paise,entry_date,due_date,description)
 SELECT gen_random_uuid(),agency_id,resident_id,'MERCHANDISE_CASH','merchandise-cash:'||id::text,amount_paise,charge_date,charge_date,'Confirmed seasonal cash sale' FROM daybook.merchandise_charges WHERE settlement='CASH' AND amount_paise>0 ON CONFLICT(agency_id,source_key) DO NOTHING;
INSERT INTO daybook.ledger_entries(id,agency_id,resident_id,kind,source_key,amount_paise,entry_date,due_date,description)
 SELECT gen_random_uuid(),agency_id,resident_id,'MERCHANDISE_CASH_PAYMENT','merchandise-cash-payment:'||id::text,-amount_paise,charge_date,charge_date,'Confirmed seasonal cash receipt' FROM daybook.merchandise_charges WHERE settlement='CASH' AND amount_paise>0 ON CONFLICT(agency_id,source_key) DO NOTHING;
INSERT INTO daybook.ledger_settlements(id,agency_id,debit_entry_id,credit_entry_id,amount_paise)
 SELECT gen_random_uuid(),c.agency_id,d.id,p.id,c.amount_paise FROM daybook.merchandise_charges c JOIN daybook.ledger_entries d ON(d.agency_id,d.source_key)=(c.agency_id,'merchandise-cash:'||c.id::text) JOIN daybook.ledger_entries p ON(p.agency_id,p.source_key)=(c.agency_id,'merchandise-cash-payment:'||c.id::text) WHERE c.settlement='CASH' AND c.amount_paise>0 AND NOT EXISTS(SELECT 1 FROM daybook.ledger_settlements s WHERE(s.agency_id,s.debit_entry_id,s.credit_entry_id)=(c.agency_id,d.id,p.id));
