-- Protected staging session only. Metadata, never rows or function source.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '30s';
SELECT jsonb_build_object(
 'server_version',current_setting('server_version'),
 'read_only',current_setting('transaction_read_only'),
 'schemas',(SELECT jsonb_agg(jsonb_build_object('name',nspname,'owner',pg_get_userbyid(nspowner),'acl',nspacl)) FROM pg_namespace WHERE nspname IN ('public','runtime_bridge')),
 'roles',(SELECT jsonb_agg(jsonb_build_object('name',rolname,'superuser',rolsuper,'inherit',rolinherit,'login',rolcanlogin,'bypass_rls',rolbypassrls)) FROM pg_roles),
 'role_membership',(SELECT jsonb_agg(jsonb_build_object('role',pg_get_userbyid(roleid),'member',pg_get_userbyid(member),'admin',admin_option,'inherit',inherit_option,'set',set_option,'grantor',pg_get_userbyid(grantor))) FROM pg_auth_members),
 'default_acl',(SELECT jsonb_agg(jsonb_build_object('owner',pg_get_userbyid(defaclrole),'schema',n.nspname,'type',defaclobjtype,'acl',defaclacl)) FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace),
 'column_acl',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'column',a.attname,'acl',a.attacl)) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','runtime_bridge') AND a.attacl IS NOT NULL),
 'extensions',(SELECT jsonb_agg(jsonb_build_object('name',extname,'version',extversion)) FROM pg_extension),
 'columns',(SELECT jsonb_agg(jsonb_build_object('schema',table_schema,'table',table_name,'column',column_name,'type',udt_name,'nullable',is_nullable)) FROM information_schema.columns WHERE table_schema IN ('public','runtime_bridge')),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'table',r.relname,'name',c.conname,'type',c.contype,'validated',c.convalidated,'definition_hash',md5(pg_get_constraintdef(c.oid)))) FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname IN ('public','runtime_bridge')),
 'indexes',(SELECT jsonb_agg(jsonb_build_object('schema',schemaname,'table',tablename,'name',indexname,'definition_hash',md5(indexdef))) FROM pg_indexes WHERE schemaname IN ('public','runtime_bridge')),
 'tables',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'acl',c.relacl)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','runtime_bridge') AND c.relkind IN ('r','p','v','S')),
 'policies',(SELECT jsonb_agg(jsonb_build_object('schema',schemaname,'table',tablename,'name',policyname,'roles',roles,'command',cmd,'using_hash',md5(coalesce(qual,'')),'check_hash',md5(coalesce(with_check,'')))) FROM pg_policies WHERE schemaname IN ('public','runtime_bridge')),
 'functions',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'arguments',pg_get_function_identity_arguments(p.oid),'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'config_hash',md5(p.proconfig::text),'acl',p.proacl,'definition_hash',md5(pg_get_functiondef(p.oid)))) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','runtime_bridge') AND p.prokind='f'),
 'triggers',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',t.tgname,'enabled',t.tgenabled,'definition_hash',md5(pg_get_triggerdef(t.oid)))) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','runtime_bridge') AND NOT t.tgisinternal),
 'migration_history',(SELECT jsonb_agg(jsonb_build_object('version',version,'name',name,'statements_hash',md5(statements::text))) FROM supabase_migrations.schema_migrations)
);
ROLLBACK;
