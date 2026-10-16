import io
from pathlib import Path
import tarfile
import tempfile
import unittest

from inspect_restore_archive import InvalidArchive, inspect


class ArchiveTests(unittest.TestCase):
    def build(self, extra=None, dump=b"PGDMP" + b"x" * 100):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        path = Path(temp.name) / "test.tar.gz"
        with tarfile.open(path, "w:gz") as archive:
            for name, data in [("db.dump", dump), ("globals.sql", b"x" * 100), ("toc.txt", b"x" * 100)]:
                member = tarfile.TarInfo(name)
                member.size = len(data)
                archive.addfile(member, io.BytesIO(data))
            if extra:
                archive.addfile(extra)
        return path

    def test_structure_is_not_restore_proof(self):
        result = inspect(self.build(), 1000)
        self.assertEqual(result["restore"], "NOT_RUN")
        self.assertFalse(result["authorization"])

    def test_size_limit(self):
        with self.assertRaises(InvalidArchive):
            inspect(self.build(), 100)

    def test_duplicate(self):
        with self.assertRaises(InvalidArchive):
            inspect(self.build(tarfile.TarInfo("db.dump")), 1000)

    def test_traversal(self):
        with self.assertRaises(InvalidArchive):
            inspect(self.build(tarfile.TarInfo("../secret")), 1000)

    def test_header(self):
        with self.assertRaises(InvalidArchive):
            inspect(self.build(dump=b"bad" * 100), 1000)

    def test_symlink(self):
        member = tarfile.TarInfo("db.dump")
        member.type = tarfile.SYMTYPE
        member.linkname = "/etc/passwd"
        with self.assertRaises(InvalidArchive):
            inspect(self.build(member), 1000)


if __name__ == "__main__":
    unittest.main()
