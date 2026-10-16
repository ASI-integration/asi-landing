import copy
import hashlib
import io
import os
from pathlib import Path
import tempfile
import unittest

import execution_manifest as verifier


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


class BindingTests(unittest.TestCase):
    def setUp(self):
        self.archive = b'synthetic archive bytes; not an executable artifact'
        self.sql = {'supabase/migrations/20261016090000_first.sql': b'SELECT 1;\n',
                    'supabase/migrations/20261016213000_second.sql': b'SELECT 2;\n'}
        self.manifest = {
            'schemaVersion': verifier.SCHEMA, 'repository': verifier.REPOSITORY,
            'target': {'environment': 'staging', 'projectRef': 'meeravcldnmocjtlqoeu',
                       'service': 'asi-landing-staging', 'releaseRoot': '/var/www/asi-staging/releases'},
            'release': {'gitSha': 'a' * 40, 'sourceTreeSha': 'b' * 40,
                        'archive': 'asi-staging-' + 'a' * 40 + '.tgz', 'sha256': sha(self.archive),
                        'bytes': len(self.archive), 'sourceLockSha256': 'c' * 64},
            'migrations': [{'path': path, 'sha256': sha(raw)} for path, raw in self.sql.items()],
            'provenance': {'taskId': 'offline-fixture', 'taskCycle': 'fixture-cycle',
                           'requestedAction': 'staging_migration',
                           'workflowRef': verifier.REPOSITORY + '/.github/workflows/fixture-only.yml@refs/heads/main',
                           'workflowSha': 'd' * 40, 'runId': 1, 'runAttempt': 1, 'artifactId': 2,
                           'reviewReference': 'fixture-only-not-approval'},
        }
        self.expected = copy.deepcopy(self.manifest)
        self.package = {**self.manifest['release'], 'g0SourceSha': 'e' * 40,
                        'environment': 'staging', 'appVersion': '0.1.0', 'activationPerformed': False}

    def validate(self):
        return verifier.validate_manifest(self.manifest, self.expected, self.package,
                                          self.sql, io.BytesIO(self.archive))

    def test_bound_bytes_never_authorize(self):
        result = self.validate()
        self.assertEqual(result['status'], 'BOUND_NOT_AUTHORIZED')
        self.assertFalse(result['authorization'])
        self.assertFalse(result['mutationAllowed'])
        self.assertFalse(result['provenanceAuthenticated'])
        self.assertEqual(result['migrationCount'], 2)

    def test_receipt_booleans_are_not_authority(self):
        self.manifest['approved'] = True
        self.expected['approved'] = True
        with self.assertRaisesRegex(verifier.BindingError, 'MANIFEST_FIELDS'):
            self.validate()

    def test_repository_and_target_mismatch_rejected(self):
        for key, value in [('repository', 'other/asi-landing'), ('target', {**self.manifest['target'], 'environment': 'production'})]:
            with self.subTest(key=key):
                original = self.manifest[key]
                self.manifest[key] = value
                with self.assertRaises(verifier.BindingError):
                    self.validate()
                self.manifest[key] = original

    def test_release_sha_tree_package_mismatch_rejected(self):
        for field in ('gitSha', 'sourceTreeSha', 'sha256'):
            with self.subTest(field=field):
                original = self.package[field]
                self.package[field] = 'f' * len(original)
                with self.assertRaisesRegex(verifier.BindingError, 'PACKAGE_BINDING_MISMATCH'):
                    self.validate()
                self.package[field] = original

    def test_provenance_scope_attempt_and_workflow_mismatch_rejected(self):
        for field, value in [('runAttempt', 2), ('taskCycle', 'other-cycle'),
                             ('requestedAction', 'staging_activation'), ('workflowSha', 'f' * 40)]:
            with self.subTest(field=field):
                original = self.manifest['provenance'][field]
                self.manifest['provenance'][field] = value
                with self.assertRaisesRegex(verifier.BindingError, 'EXPECTED_BINDING_MISMATCH'):
                    self.validate()
                self.manifest['provenance'][field] = original
        self.manifest['provenance']['runId'] = True
        with self.assertRaisesRegex(verifier.BindingError, 'PROVENANCE_IDS'):
            self.validate()

    def test_reordered_sql_rejected(self):
        self.manifest['migrations'].reverse()
        with self.assertRaisesRegex(verifier.BindingError, 'EXPECTED_BINDING_MISMATCH'):
            self.validate()

    def test_duplicate_version_rejected(self):
        self.manifest['migrations'][1]['path'] = 'supabase/migrations/20261016090000_other.sql'
        with self.assertRaisesRegex(verifier.BindingError, 'DUPLICATE_MIGRATION_VERSION'):
            self.validate()

    def test_path_escape_and_sql_symlink_rejected(self):
        for path in ('../private.sql', '/supabase/migrations/20261016090000_first.sql',
                     'supabase/migrations/../20261016090000_first.sql'):
            with self.subTest(path=path):
                self.manifest['migrations'][0]['path'] = path
                with self.assertRaisesRegex(verifier.BindingError, 'MIGRATION_PATH'):
                    self.validate()
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'elsewhere').mkdir()
            (root / 'supabase').symlink_to(root / 'elsewhere', target_is_directory=True)
            with self.assertRaisesRegex(verifier.BindingError, 'SQL_SYMLINK'):
                verifier.sql_file(root, 'supabase/migrations/20261016090000_first.sql')

    def test_sql_corruption_and_missing_bytes_rejected(self):
        path = next(iter(self.sql))
        self.sql[path] += b'-- changed'
        with self.assertRaisesRegex(verifier.BindingError, 'SQL_BYTES_MISMATCH'):
            self.validate()
        del self.sql[path]
        with self.assertRaisesRegex(verifier.BindingError, 'SQL_FILE_SET'):
            self.validate()

    def test_archive_corruption_rejected(self):
        self.archive = b'X' + self.archive[1:]
        with self.assertRaisesRegex(verifier.BindingError, 'ARCHIVE_BYTES_MISMATCH'):
            self.validate()

    def test_duplicate_json_keys_rejected(self):
        with self.assertRaisesRegex(verifier.BindingError, 'DUPLICATE_JSON_KEY'):
            verifier.load_json('{"provenance":{"runId":1,"runId":2}}')

    def test_parser_resource_limits_rejected_with_fixed_error(self):
        for raw in ('[' * 10000 + '0' + ']' * 10000, '1' * 10000):
            with self.subTest(kind='nested' if raw[0] == '[' else 'integer'):
                with self.assertRaisesRegex(verifier.BindingError, '^INVALID_JSON$'):
                    verifier.load_json(raw)

    def test_json_file_descriptor_rejects_fifo(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'input.json'
            path.write_text('{"fixture":true}')
            self.assertEqual(verifier.read_regular_json(path, 'MANIFEST_FILE'), {'fixture': True})
            path.unlink()
            os.mkfifo(path)
            for code in ('MANIFEST_FILE', 'EXPECTED_BINDING_FILE', 'PACKAGE_FILE'):
                with self.subTest(code=code):
                    with self.assertRaisesRegex(verifier.BindingError, '^' + code + '$'):
                        verifier.read_regular_json(path, code)

    def test_unknown_fields_and_nonmain_provenance_rejected(self):
        self.package['protected_environment_approved'] = True
        with self.assertRaisesRegex(verifier.BindingError, 'PACKAGE_FIELDS'):
            self.validate()
        del self.package['protected_environment_approved']
        self.manifest['provenance']['workflowRef'] = self.manifest['provenance']['workflowRef'].replace('refs/heads/main', 'refs/heads/feature')
        with self.assertRaisesRegex(verifier.BindingError, 'WORKFLOW_REF'):
            self.validate()


if __name__ == '__main__':
    unittest.main()
