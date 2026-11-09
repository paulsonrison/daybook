-- Run migrations with the separate administrative connection, never the application role.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'daybook_app') THEN
    CREATE ROLE daybook_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'daybook_auth') THEN
    CREATE ROLE daybook_auth NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
REVOKE ALL ON SCHEMA daybook FROM PUBLIC;
GRANT USAGE ON SCHEMA daybook TO daybook_app, daybook_auth;

CREATE FUNCTION daybook.current_agency() RETURNS uuid LANGUAGE sql STABLE
SET search_path = pg_catalog
AS $$ SELECT nullif(current_setting('daybook.agency_id', true), '')::uuid $$;

CREATE TABLE daybook.agencies (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE daybook.agents (
  id uuid PRIMARY KEY,
  agency_id uuid NOT NULL REFERENCES daybook.agencies(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agency_id, id)
);
CREATE TABLE daybook.sessions (
  token_hash text PRIMARY KEY CHECK (length(token_hash) = 64),
  agency_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (agency_id, agent_id) REFERENCES daybook.agents(agency_id,id)
);
CREATE INDEX sessions_agent ON daybook.sessions (agency_id,agent_id);
CREATE INDEX sessions_expiry ON daybook.sessions (expires_at);

ALTER TABLE daybook.agencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE daybook.agencies FORCE ROW LEVEL SECURITY;
CREATE POLICY agency_scope ON daybook.agencies TO daybook_app
USING (id = daybook.current_agency()) WITH CHECK (id = daybook.current_agency());
ALTER TABLE daybook.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE daybook.agents FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_scope ON daybook.agents TO daybook_app
USING (agency_id = daybook.current_agency()) WITH CHECK (agency_id = daybook.current_agency());
ALTER TABLE daybook.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE daybook.sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY session_scope ON daybook.sessions TO daybook_app
USING (agency_id = daybook.current_agency()) WITH CHECK (agency_id = daybook.current_agency());
GRANT SELECT,INSERT,UPDATE,DELETE ON daybook.agencies,daybook.agents,daybook.sessions TO daybook_app;

-- Only the non-login authentication function owner may read across tenant scopes.
-- The runtime role cannot assume this role or access these function bodies as owner.
GRANT SELECT ON daybook.agencies,daybook.agents,daybook.sessions TO daybook_auth;
CREATE POLICY auth_agencies ON daybook.agencies FOR SELECT TO daybook_auth USING (true);
CREATE POLICY auth_agents ON daybook.agents FOR SELECT TO daybook_auth USING (true);
CREATE POLICY auth_sessions ON daybook.sessions FOR SELECT TO daybook_auth USING (true);

CREATE FUNCTION daybook.login_identity(p_email text)
RETURNS TABLE(id uuid,agency_id uuid,name text,email text,password_hash text,agency_name text)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog
AS $$ SELECT a.id,a.agency_id,a.name,a.email,a.password_hash,g.name
FROM daybook.agents a JOIN daybook.agencies g ON g.id=a.agency_id WHERE a.email=p_email $$;
ALTER FUNCTION daybook.login_identity(text) OWNER TO daybook_auth;
REVOKE ALL ON FUNCTION daybook.login_identity(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION daybook.login_identity(text) TO daybook_app;

CREATE FUNCTION daybook.session_identity(p_hash text)
RETURNS TABLE(id uuid,agency_id uuid,name text,email text,agency_name text)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog
AS $$ SELECT a.id,a.agency_id,a.name,a.email,g.name
FROM daybook.sessions s JOIN daybook.agents a ON (a.agency_id,a.id)=(s.agency_id,s.agent_id)
JOIN daybook.agencies g ON g.id=a.agency_id
WHERE s.token_hash=p_hash AND s.expires_at>now() $$;
ALTER FUNCTION daybook.session_identity(text) OWNER TO daybook_auth;
REVOKE ALL ON FUNCTION daybook.session_identity(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION daybook.session_identity(text) TO daybook_app;

-- Global abuse counters contain only one-way hashed keys, never tenant operational data.
CREATE TABLE daybook.auth_attempts (key text PRIMARY KEY, attempts integer NOT NULL, reset_at timestamptz NOT NULL);
REVOKE ALL ON daybook.auth_attempts FROM PUBLIC,daybook_app;
GRANT SELECT,INSERT,UPDATE ON daybook.auth_attempts TO daybook_auth;
CREATE FUNCTION daybook.allow_auth_attempt(p_key text, p_limit integer) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog
AS $$ INSERT INTO daybook.auth_attempts AS old(key,attempts,reset_at)
VALUES(p_key,1,now()+interval '15 minutes')
ON CONFLICT(key) DO UPDATE SET
attempts=CASE WHEN old.reset_at<=now() THEN 1 ELSE old.attempts+1 END,
reset_at=CASE WHEN old.reset_at<=now() THEN now()+interval '15 minutes' ELSE old.reset_at END
RETURNING attempts<=p_limit $$;
ALTER FUNCTION daybook.allow_auth_attempt(text,integer) OWNER TO daybook_auth;
REVOKE ALL ON FUNCTION daybook.allow_auth_attempt(text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION daybook.allow_auth_attempt(text,integer) TO daybook_app;
