CREATE TABLE daybook.payments (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,resident_id uuid NOT NULL,request_id uuid NOT NULL,purpose text NOT NULL CHECK(purpose IN('ACCOUNT','DEPOSIT')),method text NOT NULL CHECK(method IN('CASH','UPI','BANK','CHEQUE')),
 amount_paise bigint NOT NULL CHECK(amount_paise>0),received_date date NOT NULL,reference text,normalized_reference text GENERATED ALWAYS AS (upper(btrim(reference))) STORED,
 target_invoice_id uuid,status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','CONFIRMED','FAILED')),receipt_code text,confirmation_evidence text NOT NULL DEFAULT '',confirmed_at timestamptz,confirmed_by uuid,posting_date date,deposit_entry_id uuid,version integer NOT NULL DEFAULT 1,recorded_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(agency_id,id),UNIQUE(agency_id,request_id),UNIQUE(agency_id,receipt_code),UNIQUE(agency_id,method,normalized_reference),
 FOREIGN KEY(agency_id,resident_id) REFERENCES daybook.residents(agency_id,id),FOREIGN KEY(agency_id,resident_id,target_invoice_id) REFERENCES daybook.invoices(agency_id,resident_id,id),FOREIGN KEY(agency_id,confirmed_by) REFERENCES daybook.agents(agency_id,id),FOREIGN KEY(agency_id,recorded_by) REFERENCES daybook.agents(agency_id,id),FOREIGN KEY(agency_id,deposit_entry_id) REFERENCES daybook.deposit_entries(agency_id,id),
 CHECK((status='CONFIRMED' AND receipt_code IS NOT NULL AND confirmed_at IS NOT NULL AND confirmed_by IS NOT NULL AND posting_date IS NOT NULL AND length(btrim(confirmation_evidence))>0) OR(status<>'CONFIRMED' AND receipt_code IS NULL AND confirmed_at IS NULL AND confirmed_by IS NULL AND posting_date IS NULL AND deposit_entry_id IS NULL)),
 CHECK(status<>'CONFIRMED' OR method='CASH' OR reference IS NOT NULL),CHECK(reference IS NULL OR length(btrim(reference)) BETWEEN 1 AND 120),CHECK(purpose='ACCOUNT' OR target_invoice_id IS NULL),CHECK(status<>'CONFIRMED' OR (purpose='DEPOSIT')=(deposit_entry_id IS NOT NULL))
);
CREATE UNIQUE INDEX payment_one_unresolved ON daybook.payments(agency_id,resident_id,purpose) WHERE status='PENDING';
ALTER TABLE daybook.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE daybook.payments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON daybook.payments TO daybook_app USING(agency_id=daybook.current_agency()) WITH CHECK(agency_id=daybook.current_agency());
GRANT SELECT,INSERT,UPDATE ON daybook.payments TO daybook_app;
CREATE FUNCTION daybook.guard_payment_update() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,daybook AS $$ BEGIN
 IF OLD.status<>'PENDING' OR NEW.status='PENDING' OR NEW.version<>OLD.version+1 OR (NEW.id,NEW.agency_id,NEW.resident_id,NEW.request_id,NEW.purpose,NEW.method,NEW.amount_paise,NEW.received_date,NEW.target_invoice_id,NEW.recorded_by,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.agency_id,OLD.resident_id,OLD.request_id,OLD.purpose,OLD.method,OLD.amount_paise,OLD.received_date,OLD.target_invoice_id,OLD.recorded_by,OLD.created_at) THEN RAISE EXCEPTION 'Payment identity or finalized outcome is immutable' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER payment_finality BEFORE UPDATE ON daybook.payments FOR EACH ROW EXECUTE FUNCTION daybook.guard_payment_update();
CREATE FUNCTION daybook.guard_payment_effect() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,daybook AS $$ DECLARE payment daybook.payments%ROWTYPE;posted numeric;deposit daybook.deposit_entries%ROWTYPE;BEGIN
 SELECT * INTO payment FROM daybook.payments WHERE agency_id=NEW.agency_id AND id=NEW.id;
 SELECT coalesce(sum(amount_paise),0) INTO posted FROM daybook.ledger_entries WHERE agency_id=payment.agency_id AND source_key='payment:'||payment.id::text;
 IF payment.status='CONFIRMED' AND payment.purpose='ACCOUNT' AND posted<>-payment.amount_paise THEN RAISE EXCEPTION 'Confirmed payment needs its exact ledger credit' USING ERRCODE='23514';END IF;
 IF (payment.status<>'CONFIRMED' OR payment.purpose<>'ACCOUNT') AND posted<>0 THEN RAISE EXCEPTION 'Unconfirmed funds cannot settle account debt' USING ERRCODE='23514';END IF;
 IF payment.status='CONFIRMED' AND payment.purpose='DEPOSIT' THEN SELECT * INTO deposit FROM daybook.deposit_entries WHERE agency_id=payment.agency_id AND id=payment.deposit_entry_id;IF deposit.id IS NULL OR deposit.kind<>'RECEIVED' OR deposit.resident_id<>payment.resident_id OR deposit.amount_paise<>payment.amount_paise OR deposit.receipt_code<>payment.receipt_code THEN RAISE EXCEPTION 'Confirmed deposit needs its matching liability receipt' USING ERRCODE='23514';END IF;END IF;RETURN NULL;END $$;
CREATE CONSTRAINT TRIGGER payment_effect AFTER INSERT OR UPDATE ON daybook.payments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION daybook.guard_payment_effect();

CREATE TABLE daybook.clearances (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,resident_id uuid NOT NULL,code text NOT NULL,termination_date date NOT NULL,snapshot jsonb NOT NULL,final_invoice_id uuid,created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(agency_id,id),UNIQUE(agency_id,resident_id),UNIQUE(agency_id,resident_id,id),UNIQUE(agency_id,code),FOREIGN KEY(agency_id,resident_id) REFERENCES daybook.residents(agency_id,id),FOREIGN KEY(agency_id,resident_id,final_invoice_id) REFERENCES daybook.invoices(agency_id,resident_id,id),FOREIGN KEY(agency_id,created_by) REFERENCES daybook.agents(agency_id,id)
);
CREATE TABLE daybook.clearance_refunds (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,clearance_id uuid NOT NULL,resident_id uuid NOT NULL,request_id uuid NOT NULL,receipt_code text NOT NULL,amount_paise bigint NOT NULL CHECK(amount_paise>0),deposit_paise bigint NOT NULL CHECK(deposit_paise>=0),account_credit_paise bigint NOT NULL CHECK(account_credit_paise>=0),method text NOT NULL CHECK(method IN('CASH','UPI','BANK')),reference text,confirmation_evidence text NOT NULL,posting_date date NOT NULL,created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(amount_paise=deposit_paise+account_credit_paise),CHECK(length(btrim(confirmation_evidence))>0),CHECK(method='CASH' OR reference IS NOT NULL),UNIQUE(agency_id,id),UNIQUE(agency_id,request_id),UNIQUE(agency_id,receipt_code),UNIQUE(agency_id,method,reference),FOREIGN KEY(agency_id,resident_id,clearance_id) REFERENCES daybook.clearances(agency_id,resident_id,id),FOREIGN KEY(agency_id,resident_id) REFERENCES daybook.residents(agency_id,id),FOREIGN KEY(agency_id,created_by) REFERENCES daybook.agents(agency_id,id)
);
DO $$ DECLARE name text;BEGIN FOREACH name IN ARRAY ARRAY['clearances','clearance_refunds'] LOOP
 EXECUTE format('ALTER TABLE daybook.%I ENABLE ROW LEVEL SECURITY',name);EXECUTE format('ALTER TABLE daybook.%I FORCE ROW LEVEL SECURITY',name);EXECUTE format('CREATE POLICY tenant_scope ON daybook.%I TO daybook_app USING(agency_id=daybook.current_agency()) WITH CHECK(agency_id=daybook.current_agency())',name);EXECUTE format('GRANT SELECT,INSERT ON daybook.%I TO daybook_app',name);END LOOP;END $$;
CREATE FUNCTION daybook.guard_deposit_balance() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,daybook AS $$ DECLARE previous numeric;next_balance numeric;BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('ledger:'||NEW.agency_id::text,0));SELECT coalesce(sum(CASE WHEN kind='RECEIVED' THEN amount_paise ELSE -amount_paise END),0) INTO previous FROM daybook.deposit_entries WHERE agency_id=NEW.agency_id AND resident_id=NEW.resident_id;
 next_balance:=previous+CASE WHEN NEW.kind='RECEIVED' THEN NEW.amount_paise ELSE -NEW.amount_paise END;IF next_balance<0 OR next_balance<>NEW.balance_after_paise THEN RAISE EXCEPTION 'Deposit movement exceeds or disagrees with its available balance' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER deposit_bounded_balance BEFORE INSERT ON daybook.deposit_entries FOR EACH ROW EXECUTE FUNCTION daybook.guard_deposit_balance();

CREATE TABLE daybook.credit_policies (
 agency_id uuid PRIMARY KEY REFERENCES daybook.agencies(id),max_overdue_paise bigint CHECK(max_overdue_paise>=0),max_overdue_days integer DEFAULT 60 CHECK(max_overdue_days BETWEEN 1 AND 3650),enabled boolean NOT NULL DEFAULT true,version integer NOT NULL DEFAULT 1,CHECK(NOT enabled OR max_overdue_paise IS NOT NULL OR max_overdue_days IS NOT NULL)
);
CREATE TABLE daybook.collection_settings (
 agency_id uuid PRIMARY KEY REFERENCES daybook.agencies(id),upi_id text NOT NULL,payee_name text NOT NULL,confirmed_by uuid NOT NULL,confirmed_at timestamptz NOT NULL DEFAULT now(),version integer NOT NULL DEFAULT 1,FOREIGN KEY(agency_id,confirmed_by) REFERENCES daybook.agents(agency_id,id)
);
CREATE TABLE daybook.notification_intents (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,resident_id uuid NOT NULL,kind text NOT NULL,channel text NOT NULL CHECK(channel IN('WHATSAPP','SMS')),recipient text NOT NULL,locale text NOT NULL DEFAULT 'en',payload jsonb NOT NULL,dedupe_key text NOT NULL,status text NOT NULL DEFAULT 'NOT_CONFIGURED' CHECK(status IN('NOT_CONFIGURED','PENDING','SENT','FAILED','CANCELLED')),created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(agency_id,id),UNIQUE(agency_id,dedupe_key),FOREIGN KEY(agency_id,resident_id) REFERENCES daybook.residents(agency_id,id),FOREIGN KEY(agency_id,created_by) REFERENCES daybook.agents(agency_id,id)
);
DO $$ DECLARE name text;BEGIN FOREACH name IN ARRAY ARRAY['credit_policies','collection_settings','notification_intents'] LOOP
 EXECUTE format('ALTER TABLE daybook.%I ENABLE ROW LEVEL SECURITY',name);EXECUTE format('ALTER TABLE daybook.%I FORCE ROW LEVEL SECURITY',name);EXECUTE format('CREATE POLICY tenant_scope ON daybook.%I TO daybook_app USING(agency_id=daybook.current_agency()) WITH CHECK(agency_id=daybook.current_agency())',name);EXECUTE format('GRANT SELECT,INSERT ON daybook.%I TO daybook_app',name);END LOOP;END $$;
GRANT UPDATE ON daybook.credit_policies,daybook.collection_settings TO daybook_app;

CREATE FUNCTION daybook.guard_refund_effect() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,daybook AS $$ DECLARE liability numeric;credit numeric;BEGIN
 SELECT coalesce(sum(amount_paise),0) INTO liability FROM daybook.deposit_entries WHERE agency_id=NEW.agency_id AND resident_id=NEW.resident_id AND kind='REFUNDED' AND receipt_code=NEW.receipt_code;
 SELECT coalesce(sum(amount_paise),0) INTO credit FROM daybook.ledger_entries WHERE agency_id=NEW.agency_id AND resident_id=NEW.resident_id AND kind='REFUND' AND source_key='clearance-refund:'||NEW.id::text;
 IF liability<>NEW.deposit_paise OR credit<>NEW.account_credit_paise THEN RAISE EXCEPTION 'Refund receipt requires its matching liability and account credit movements' USING ERRCODE='23514';END IF;RETURN NULL;END $$;
CREATE CONSTRAINT TRIGGER refund_effect AFTER INSERT ON daybook.clearance_refunds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION daybook.guard_refund_effect();

ALTER TABLE daybook.payments ADD COLUMN balance_after_paise numeric CHECK(balance_after_paise IS NULL OR balance_after_paise::text ~ '^-?[0-9]+$');
ALTER TABLE daybook.payments ADD CONSTRAINT payment_confirmation_balance CHECK((status='CONFIRMED')=(balance_after_paise IS NOT NULL));
