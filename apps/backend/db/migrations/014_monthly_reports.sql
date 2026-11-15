CREATE TABLE daybook.agency_reports (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN('OPERATIONS','SALES','TAX')),month date NOT NULL CHECK(extract(day FROM month)=1),locale text NOT NULL CHECK(locale IN('en','ml','hi')),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object' AND octet_length(snapshot::text)<=3145728),snapshot_hash text NOT NULL CHECK(snapshot_hash~'^[a-f0-9]{64}$'),created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(agency_id,id),FOREIGN KEY(agency_id,created_by) REFERENCES daybook.agents(agency_id,id)
);
CREATE INDEX agency_reports_recent ON daybook.agency_reports(agency_id,created_at DESC,id);
ALTER TABLE daybook.agency_reports ENABLE ROW LEVEL SECURITY;ALTER TABLE daybook.agency_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON daybook.agency_reports TO daybook_app USING(agency_id=daybook.current_agency()) WITH CHECK(agency_id=daybook.current_agency());
GRANT SELECT,INSERT ON daybook.agency_reports TO daybook_app;
CREATE TABLE daybook.report_artifacts (
 agency_id uuid NOT NULL,report_id uuid NOT NULL,format text NOT NULL CHECK(format IN('PDF','XLSX')),status text NOT NULL DEFAULT 'PREPARED' CHECK(status IN('PREPARED','GENERATING','READY','FAILED')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),lease_until timestamptz,body bytea,sha256 text CHECK(sha256~'^[a-f0-9]{64}$'),byte_length integer GENERATED ALWAYS AS(octet_length(body)) STORED,last_error text,
 PRIMARY KEY(agency_id,report_id,format),FOREIGN KEY(agency_id,report_id) REFERENCES daybook.agency_reports(agency_id,id),
 CHECK((status='GENERATING')=(lease_until IS NOT NULL)),CHECK((status='READY')=(body IS NOT NULL AND sha256 IS NOT NULL)),CHECK(body IS NULL OR octet_length(body) BETWEEN 100 AND 10485760)
);
ALTER TABLE daybook.report_artifacts ENABLE ROW LEVEL SECURITY;ALTER TABLE daybook.report_artifacts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON daybook.report_artifacts TO daybook_app USING(agency_id=daybook.current_agency()) WITH CHECK(agency_id=daybook.current_agency());
GRANT SELECT,INSERT ON daybook.report_artifacts TO daybook_app;
GRANT UPDATE(status,attempts,lease_until,body,sha256,last_error) ON daybook.report_artifacts TO daybook_app;
CREATE FUNCTION daybook.guard_ready_report_artifact() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,daybook AS $$ BEGIN
 IF OLD.status='READY' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Issued report artifacts are immutable' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER report_artifact_finality BEFORE UPDATE ON daybook.report_artifacts FOR EACH ROW EXECUTE FUNCTION daybook.guard_ready_report_artifact();
