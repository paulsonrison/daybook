-- Operator-only metadata for whole-database backups. Never grant this to HTTP roles.
CREATE TABLE daybook.operator_backup_runs (
 id uuid PRIMARY KEY,period date NOT NULL UNIQUE,scope_id uuid NOT NULL,key_id text NOT NULL CHECK(key_id~'^[A-Za-z0-9_-]{1,64}$'),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','RUNNING','VERIFIED','PARTIAL','FAILED')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),object_id uuid,lease_token uuid,lease_until timestamptz,
 archive_bytes integer CHECK(archive_bytes BETWEEN 1 AND 33554432),sha256 text CHECK(sha256~'^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,
 CHECK((status='RUNNING')=(lease_token IS NOT NULL)),CHECK((lease_token IS NULL)=(lease_until IS NULL)),
 CHECK((archive_bytes IS NULL)=(sha256 IS NULL))
);
CREATE TABLE daybook.operator_backup_objects (
 object_id uuid NOT NULL,destination text NOT NULL CHECK(destination IN('neon','b2')),run_id uuid NOT NULL REFERENCES daybook.operator_backup_runs(id),
 attempt integer NOT NULL CHECK(attempt BETWEEN 1 AND 3),scope_id uuid NOT NULL,key_id text NOT NULL,
 status text NOT NULL CHECK(status IN('RESERVED','VERIFIED','FAILED','DELETED')),reserved_bytes integer NOT NULL CHECK(reserved_bytes BETWEEN 37 AND 33554468),
 sha256 text NOT NULL CHECK(sha256~'^[a-f0-9]{64}$'),created_at timestamptz NOT NULL,verified_at timestamptz,
 PRIMARY KEY(object_id,destination),UNIQUE(run_id,attempt,destination),CHECK((status='VERIFIED')=(verified_at IS NOT NULL))
);
CREATE INDEX backup_objects_capacity ON daybook.operator_backup_objects(destination,status);
REVOKE ALL ON daybook.operator_backup_runs,daybook.operator_backup_objects FROM PUBLIC,daybook_app,daybook_auth,daybook_scheduler;
