"""Regression of the existing G2 witness descriptor checks; no host reads."""
import stat
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import beget_g2_operator_witness as w

class IdentityTests(unittest.TestCase):
    def model(self, **changes):
        return SimpleNamespace(**(dict(st_dev=1, st_ino=7, st_mode=stat.S_IFREG | 0o600,
            st_uid=0, st_gid=0, st_nlink=1, st_size=2, st_mtime_ns=1, st_ctime_ns=1) | changes))

    def read(self, before=None, after=None, named=None):
        before = before or self.model()
        parent = self.model(st_mode=stat.S_IFDIR | 0o755)
        with patch.object(w.os, 'open', side_effect=[10, 11, 12]), \
             patch.object(w.os, 'fstat', side_effect=[parent, before, after or before]), \
             patch.object(w.os, 'stat', return_value=named or before), \
             patch.object(w.os, 'read', return_value=b'{}'), \
             patch.object(w.os, 'close') as close:
            try:
                return w.trusted_file('/etc/policy.json')
            finally:
                self.assertEqual([c.args[0] for c in close.call_args_list], [10, 12, 11])

    def test_exact_root_descriptor(self):
        self.assertEqual(self.read(), b'{}')

    def test_real_unmapped_uid_is_not_root(self):
        with self.assertRaisesRegex(w.Block, '^FILE$'):
            self.read(before=self.model(st_uid=65534))

    def test_writable_or_multiple_links_rejected(self):
        for change in ({'st_mode':stat.S_IFREG | 0o620}, {'st_mode':stat.S_IFREG | 0o602}, {'st_nlink':2}):
            with self.subTest(change=change), self.assertRaisesRegex(w.Block, '^FILE$'):
                self.read(before=self.model(**change))

    def test_descriptor_changes_rejected(self):
        for field in ('st_dev','st_ino','st_uid','st_gid','st_nlink','st_size','st_mtime_ns','st_ctime_ns'):
            with self.subTest(field=field), self.assertRaisesRegex(w.Block, '^FILE_RACE$'):
                self.read(after=self.model(**{field:999}))

    def test_named_inode_swap_rejected(self):
        with self.assertRaisesRegex(w.Block, '^FILE_RACE$'):
            self.read(named=self.model(st_ino=8))

    def test_short_read_rejected(self):
        with self.assertRaisesRegex(w.Block, '^FILE_RACE$'):
            self.read(before=self.model(st_size=3))

if __name__ == '__main__':
    unittest.main()
