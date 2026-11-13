CREATE TABLE daybook.pay_rules (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,staff_id uuid NOT NULL,start_date date NOT NULL,end_date date,employment_start date NOT NULL,employment_end date,
 mode text NOT NULL CHECK(mode IN('SALARY','PER_COPY','BLENDED')),monthly_paise bigint NOT NULL CHECK(monthly_paise>=0),copy_paise bigint NOT NULL CHECK(copy_paise>=0),route_paise bigint NOT NULL CHECK(route_paise>=0),proration text NOT NULL CHECK(proration IN('CALENDAR_DAYS','UNPRORATED')),
 UNIQUE(agency_id,id),UNIQUE(agency_id,staff_id,start_date),FOREIGN KEY(agency_id,staff_id) REFERENCES daybook.staff(agency_id,id),CHECK(end_date IS NULL OR end_date>=start_date),CHECK(employment_end IS NULL OR employment_end>=employment_start),CHECK(mode<>'SALARY' OR copy_paise=0),CHECK(mode<>'PER_COPY' OR monthly_paise=0)
);
CREATE TABLE daybook.staff_attendance (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,staff_id uuid NOT NULL,work_date date NOT NULL,status text NOT NULL CHECK(status IN('PRESENT','PAID_LEAVE','UNPAID_LEAVE','ABSENT')),note text NOT NULL,
 UNIQUE(agency_id,id),UNIQUE(agency_id,staff_id,work_date),FOREIGN KEY(agency_id,staff_id) REFERENCES daybook.staff(agency_id,id)
);
CREATE TABLE daybook.staff_funds (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,staff_id uuid NOT NULL,funds_date date NOT NULL,kind text NOT NULL CHECK(kind IN('ADVANCE','REIMBURSEMENT')),amount_paise bigint NOT NULL CHECK(amount_paise>0),method text NOT NULL CHECK(method IN('CASH','UPI','BANK','UNPAID')),reference text,evidence text NOT NULL CHECK(length(btrim(evidence))>0),recorded_by uuid NOT NULL,
 UNIQUE(agency_id,id),FOREIGN KEY(agency_id,staff_id) REFERENCES daybook.staff(agency_id,id),FOREIGN KEY(agency_id,recorded_by) REFERENCES daybook.agents(agency_id,id),CHECK(method IN('CASH','UNPAID') OR length(btrim(reference))>0),CHECK((kind='REIMBURSEMENT')=(method='UNPAID'))
);
CREATE TABLE daybook.payslips (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,staff_id uuid NOT NULL,month date NOT NULL,code text NOT NULL,snapshot jsonb NOT NULL,net_paise bigint NOT NULL CHECK(net_paise>=0),created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(agency_id,id),UNIQUE(agency_id,staff_id,id),UNIQUE(agency_id,staff_id,month),UNIQUE(agency_id,code),FOREIGN KEY(agency_id,staff_id) REFERENCES daybook.staff(agency_id,id),FOREIGN KEY(agency_id,created_by) REFERENCES daybook.agents(agency_id,id)
);
CREATE TABLE daybook.payroll_fund_claims (
 agency_id uuid NOT NULL,fund_id uuid NOT NULL,payslip_id uuid NOT NULL,amount_paise bigint NOT NULL CHECK(amount_paise>0),PRIMARY KEY(agency_id,fund_id,payslip_id),FOREIGN KEY(agency_id,fund_id) REFERENCES daybook.staff_funds(agency_id,id),FOREIGN KEY(agency_id,payslip_id) REFERENCES daybook.payslips(agency_id,id)
);
CREATE TABLE daybook.payroll_delivery_claims (
 agency_id uuid NOT NULL,delivery_id uuid NOT NULL,payslip_id uuid NOT NULL,PRIMARY KEY(agency_id,delivery_id),FOREIGN KEY(agency_id,delivery_id) REFERENCES daybook.delivery_logs(agency_id,id),FOREIGN KEY(agency_id,payslip_id) REFERENCES daybook.payslips(agency_id,id)
);
CREATE TABLE daybook.payroll_payouts (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,payslip_id uuid NOT NULL,staff_id uuid NOT NULL,amount_paise bigint NOT NULL CHECK(amount_paise>0),posting_date date NOT NULL,method text NOT NULL CHECK(method IN('CASH','UPI','BANK')),reference text,evidence text NOT NULL CHECK(length(btrim(evidence))>0),created_by uuid NOT NULL,
 UNIQUE(agency_id,id),UNIQUE(agency_id,payslip_id),FOREIGN KEY(agency_id,staff_id,payslip_id) REFERENCES daybook.payslips(agency_id,staff_id,id),FOREIGN KEY(agency_id,created_by) REFERENCES daybook.agents(agency_id,id),CHECK(method='CASH' OR length(btrim(reference))>0)
);
DO $$ DECLARE name text; BEGIN FOREACH name IN ARRAY ARRAY['pay_rules','staff_attendance','staff_funds','payslips','payroll_fund_claims','payroll_delivery_claims','payroll_payouts'] LOOP
 EXECUTE format('ALTER TABLE daybook.%I ENABLE ROW LEVEL SECURITY',name);EXECUTE format('ALTER TABLE daybook.%I FORCE ROW LEVEL SECURITY',name);
 EXECUTE format('CREATE POLICY tenant_scope ON daybook.%I TO daybook_app USING(agency_id=daybook.current_agency()) WITH CHECK(agency_id=daybook.current_agency())',name);
 EXECUTE format('GRANT SELECT,INSERT ON daybook.%I TO daybook_app',name);
END LOOP;END $$;
GRANT UPDATE ON daybook.staff_attendance TO daybook_app;
GRANT UPDATE(end_date,employment_end) ON daybook.pay_rules TO daybook_app;
CREATE FUNCTION daybook.guard_payroll_delivery() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,daybook AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM daybook.payroll_delivery_claims WHERE agency_id=OLD.agency_id AND delivery_id=OLD.id) AND (NEW.staff_id,NEW.quantity,NEW.delivery_date) IS DISTINCT FROM (OLD.staff_id,OLD.quantity,OLD.delivery_date) THEN RAISE EXCEPTION 'Posted payroll delivery attribution is immutable' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER payroll_delivery_finality BEFORE UPDATE ON daybook.delivery_logs FOR EACH ROW EXECUTE FUNCTION daybook.guard_payroll_delivery();

CREATE TABLE daybook.collection_custody (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,source_kind text NOT NULL CHECK(source_kind IN('PAYMENT','MERCHANDISE','DEPOSIT')),source_id uuid NOT NULL,custody text NOT NULL CHECK(custody IN('AGENCY','STAFF','DIGITAL')),staff_id uuid,route_id uuid,reason text NOT NULL,created_by uuid NOT NULL,
 UNIQUE(agency_id,id),UNIQUE(agency_id,source_kind,source_id),FOREIGN KEY(agency_id,staff_id) REFERENCES daybook.staff(agency_id,id),FOREIGN KEY(agency_id,route_id) REFERENCES daybook.routes(agency_id,id),FOREIGN KEY(agency_id,created_by) REFERENCES daybook.agents(agency_id,id),CHECK((custody='STAFF')=(staff_id IS NOT NULL)),CHECK(custody='STAFF' OR route_id IS NULL)
);
CREATE TABLE daybook.cash_handovers (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,staff_id uuid NOT NULL,route_id uuid NOT NULL,collection_date date NOT NULL,posting_date date NOT NULL,expected_paise bigint NOT NULL CHECK(expected_paise>=0),actual_paise bigint NOT NULL CHECK(actual_paise>=0),snapshot jsonb NOT NULL,signoff text NOT NULL,created_by uuid NOT NULL,
 UNIQUE(agency_id,id),FOREIGN KEY(agency_id,staff_id) REFERENCES daybook.staff(agency_id,id),FOREIGN KEY(agency_id,route_id) REFERENCES daybook.routes(agency_id,id),FOREIGN KEY(agency_id,created_by) REFERENCES daybook.agents(agency_id,id)
);
CREATE TABLE daybook.handover_claims (
 agency_id uuid NOT NULL,custody_id uuid NOT NULL,handover_id uuid NOT NULL,PRIMARY KEY(agency_id,custody_id),FOREIGN KEY(agency_id,custody_id) REFERENCES daybook.collection_custody(agency_id,id),FOREIGN KEY(agency_id,handover_id) REFERENCES daybook.cash_handovers(agency_id,id)
);
CREATE TABLE daybook.handover_return_claims (
 agency_id uuid NOT NULL,return_id uuid NOT NULL,handover_id uuid NOT NULL,PRIMARY KEY(agency_id,return_id),FOREIGN KEY(agency_id,return_id) REFERENCES daybook.supply_returns(agency_id,id),FOREIGN KEY(agency_id,handover_id) REFERENCES daybook.cash_handovers(agency_id,id)
);
CREATE TABLE daybook.cash_expenses (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,posting_date date NOT NULL,kind text NOT NULL CHECK(kind IN('PETTY','BANK_DEPOSIT','LATE_REMITTANCE','SUSPENSE_RESOLUTION')),amount_paise bigint NOT NULL CHECK(amount_paise>=0),handover_id uuid,reason text NOT NULL,created_by uuid NOT NULL,
 UNIQUE(agency_id,id),FOREIGN KEY(agency_id,handover_id) REFERENCES daybook.cash_handovers(agency_id,id),FOREIGN KEY(agency_id,created_by) REFERENCES daybook.agents(agency_id,id),CHECK((kind IN('LATE_REMITTANCE','SUSPENSE_RESOLUTION'))=(handover_id IS NOT NULL))
);
CREATE TABLE daybook.cash_day_closes (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,close_date date NOT NULL,opening_paise bigint NOT NULL CHECK(opening_paise>=0),counted_paise bigint NOT NULL CHECK(counted_paise>=0),bank_paise bigint NOT NULL CHECK(bank_paise>=0),expected_paise numeric NOT NULL,variance_paise numeric NOT NULL,snapshot jsonb NOT NULL,reason text NOT NULL,signoff text NOT NULL,created_by uuid NOT NULL,
 UNIQUE(agency_id,id),UNIQUE(agency_id,close_date),FOREIGN KEY(agency_id,created_by) REFERENCES daybook.agents(agency_id,id)
);
DO $$ DECLARE name text;BEGIN FOREACH name IN ARRAY ARRAY['collection_custody','cash_handovers','handover_claims','handover_return_claims','cash_expenses','cash_day_closes'] LOOP
 EXECUTE format('ALTER TABLE daybook.%I ENABLE ROW LEVEL SECURITY',name);EXECUTE format('ALTER TABLE daybook.%I FORCE ROW LEVEL SECURITY',name);EXECUTE format('CREATE POLICY tenant_scope ON daybook.%I TO daybook_app USING(agency_id=daybook.current_agency()) WITH CHECK(agency_id=daybook.current_agency())',name);EXECUTE format('GRANT SELECT,INSERT ON daybook.%I TO daybook_app',name);END LOOP;END $$;
CREATE VIEW daybook.collection_sources WITH(security_invoker=true) AS
 SELECT p.agency_id,'PAYMENT'::text AS kind,p.id,p.amount_paise,p.method,p.posting_date AS source_date,p.receipt_code,p.resident_id FROM daybook.payments p WHERE p.status='CONFIRMED'
 UNION ALL SELECT m.agency_id,'MERCHANDISE',m.id,m.amount_paise,'CASH',m.charge_date,m.receipt_code,m.resident_id FROM daybook.merchandise_charges m WHERE m.settlement='CASH'
 UNION ALL SELECT d.agency_id,'DEPOSIT',d.id,d.amount_paise,'UNKNOWN',(d.created_at AT TIME ZONE a.timezone)::date,d.receipt_code,d.resident_id FROM daybook.deposit_entries d JOIN daybook.agencies a ON a.id=d.agency_id WHERE d.kind='RECEIVED' AND NOT EXISTS(SELECT 1 FROM daybook.payments p WHERE p.deposit_entry_id=d.id);
GRANT SELECT ON daybook.collection_sources TO daybook_app;
CREATE FUNCTION daybook.agency_today() RETURNS date LANGUAGE sql STABLE SET search_path=pg_catalog,daybook AS $$ SELECT (now() AT TIME ZONE timezone)::date FROM daybook.agencies WHERE id=daybook.current_agency() $$;
ALTER TABLE daybook.staff_funds ADD COLUMN posting_date date NOT NULL DEFAULT daybook.agency_today();
CREATE FUNCTION daybook.guard_closed_cash_source() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,daybook AS $$ DECLARE movement_date date;is_cash boolean;BEGIN
 IF TG_TABLE_NAME='payments' THEN movement_date:=NEW.posting_date;is_cash:=NEW.method='CASH' AND NEW.status='CONFIRMED';
 ELSIF TG_TABLE_NAME='staff_funds' THEN movement_date:=NEW.posting_date;is_cash:=NEW.method='CASH' AND NEW.kind='ADVANCE';
 ELSIF TG_TABLE_NAME IN('payroll_payouts','clearance_refunds') THEN movement_date:=NEW.posting_date;is_cash:=NEW.method='CASH';
 ELSIF TG_TABLE_NAME='merchandise_charges' THEN movement_date:=daybook.agency_today();is_cash:=NEW.settlement='CASH';
 ELSIF TG_TABLE_NAME='deposit_entries' THEN movement_date:=daybook.agency_today();is_cash:=NEW.kind='RECEIVED' AND NOT EXISTS(SELECT 1 FROM daybook.payments WHERE agency_id=NEW.agency_id AND id=NEW.request_id AND purpose='DEPOSIT' AND method<>'CASH');
 ELSE movement_date:=NEW.posting_date;is_cash:=true;END IF;
 IF is_cash AND EXISTS(SELECT 1 FROM daybook.cash_day_closes WHERE agency_id=NEW.agency_id AND close_date=movement_date) THEN RAISE EXCEPTION 'Cash day is signed and closed' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER payment_cash_closed BEFORE INSERT OR UPDATE ON daybook.payments FOR EACH ROW EXECUTE FUNCTION daybook.guard_closed_cash_source();
DO $$ DECLARE name text;BEGIN FOREACH name IN ARRAY ARRAY['staff_funds','payroll_payouts','clearance_refunds','merchandise_charges','deposit_entries','cash_handovers','cash_expenses'] LOOP EXECUTE format('CREATE TRIGGER cash_source_closed BEFORE INSERT ON daybook.%I FOR EACH ROW EXECUTE FUNCTION daybook.guard_closed_cash_source()',name);END LOOP;END $$;
CREATE TABLE daybook.payroll_adjustments (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,staff_id uuid NOT NULL,posting_date date NOT NULL,amount_paise bigint NOT NULL CHECK(amount_paise<>0),reason text NOT NULL,created_by uuid NOT NULL,
 UNIQUE(agency_id,id),FOREIGN KEY(agency_id,staff_id) REFERENCES daybook.staff(agency_id,id),FOREIGN KEY(agency_id,created_by) REFERENCES daybook.agents(agency_id,id)
);
CREATE TABLE daybook.payroll_adjustment_claims (
 agency_id uuid NOT NULL,adjustment_id uuid NOT NULL,payslip_id uuid NOT NULL,PRIMARY KEY(agency_id,adjustment_id),FOREIGN KEY(agency_id,adjustment_id) REFERENCES daybook.payroll_adjustments(agency_id,id),FOREIGN KEY(agency_id,payslip_id) REFERENCES daybook.payslips(agency_id,id)
);
DO $$ DECLARE name text;BEGIN FOREACH name IN ARRAY ARRAY['payroll_adjustments','payroll_adjustment_claims'] LOOP EXECUTE format('ALTER TABLE daybook.%I ENABLE ROW LEVEL SECURITY',name);EXECUTE format('ALTER TABLE daybook.%I FORCE ROW LEVEL SECURITY',name);EXECUTE format('CREATE POLICY tenant_scope ON daybook.%I TO daybook_app USING(agency_id=daybook.current_agency()) WITH CHECK(agency_id=daybook.current_agency())',name);EXECUTE format('GRANT SELECT,INSERT ON daybook.%I TO daybook_app',name);END LOOP;END $$;
