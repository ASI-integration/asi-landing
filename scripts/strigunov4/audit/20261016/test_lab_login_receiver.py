import unittest
from unittest.mock import patch
import lab_login_receiver as r


class LoginTests(unittest.TestCase):
    def test_secret_only_in_environment(self):
        secret='synthetic-do-not-log'
        with patch.object(r,'command',return_value=None) as call:
            r.psql({'socket':'/lab','port':5432},'supabase_admin','SELECT 1;',secret)
        args,stdin,env=call.call_args.args
        self.assertNotIn(secret,' '.join(args))
        self.assertNotIn(secret,stdin.decode())
        self.assertEqual(env['PGPASSWORD'],secret)
        self.assertIn('PGPASSWORD',args)
        self.assertIn('unset PGSERVICE PGSERVICEFILE PGHOSTADDR PGOPTIONS',' '.join(args))

    def test_foreign_target_rejected_without_commands(self):
        with patch.object(r,'command') as call:
            with self.assertRaises(r.Block): r.identity({'nonce':'wrong'})
        call.assert_not_called()

    def test_pg_environment_not_inherited(self):
        with patch.dict(r.os.environ,{'PGSERVICE':'foreign','PGPASSWORD':'foreign','PGHOST':'remote'}):
            env=r.clean_env()
        self.assertNotIn('PGSERVICE',env)
        self.assertNotIn('PGPASSWORD',env)
        self.assertNotIn('PGHOST',env)

    def test_role_sql_injection_rejected(self):
        with patch.object(r,'command') as call:
            with self.assertRaises(r.Block): r.psql({},'a";DROP ROLE x;','SELECT 1;')
        call.assert_not_called()


if __name__=='__main__': unittest.main()
