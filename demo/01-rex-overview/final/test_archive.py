"""Archive safety and round-trip tests; fixtures stay in ignored final/.work."""

import contextlib
import io
import json
import sqlite3
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from unittest.mock import patch

import archive


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        scratch = Path(__file__).resolve().parent / ".work/tests"
        scratch.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix="archive-test-", dir=scratch)
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.final = self.root / "final"
        self.final.mkdir()
        self.inputs = self.root / "inputs"
        self.library = self.root / "source.fcpbundle"
        self.media = self.library / "Event/Original Media/clip.mp4"
        self.media.parent.mkdir(parents=True)
        self.media.write_bytes(b"synthetic media fixture")
        for name in ("CurrentVersion.flexolibrary", "Event/CurrentVersion.fcpevent"):
            with contextlib.closing(sqlite3.connect(self.library / name)) as database:
                database.execute("CREATE TABLE example (id INTEGER PRIMARY KEY)")
                database.commit()
        self.xml = self.root / "source.fcpxml"
        self.xml.write_text(
            '<fcpxml><resources><asset><media-rep src="' + self.media.as_uri()
            + '"/></asset></resources><library><event><project/></event></library></fcpxml>'
        )
        for name in ("rex-demo.mp4", *("source/" + name for name in archive.SOURCE_NAMES)):
            path = self.inputs / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('{"durationInFrames": 5035, "fps": 30}')
        self.patch = patch.object(archive, "FINAL", self.final)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.output = contextlib.redirect_stdout(io.StringIO())
        self.output.__enter__()
        self.addCleanup(self.output.__exit__, None, None, None)

    def build(self):
        archive.build(self.library, self.xml, self.inputs)

    def test_safe_paths(self):
        self.assertEqual(archive.safe_member("rex-demo.fcpbundle/Event/file").parts[-1], "file")
        for name in ("/rex-demo.fcpbundle/file", "../file", "rex-demo.fcpbundle/../../file",
                     "rex-demo.fcpbundle\\file", "different.fcpbundle/file"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                archive.safe_member(name)

    def test_cache_and_lock_exclusions(self):
        for name in ("Event/Render Files/frame", "Event/Transcoded Media/proxy.mp4",
                     "Event/__Trash/file", ".lock", "Event/.DS_Store",
                     "Event/CurrentVersion.fcpevent-wal", "arbitrary-file"):
            self.assertFalse(archive.included(Path(name)), name)
        for name in ("CurrentVersion.flexolibrary", "Event/CurrentVersion.fcpevent",
                     "Event/Original Media/clip.mp4"):
            self.assertTrue(archive.included(Path(name)), name)

    def test_media_symlink_rejected(self):
        (self.media.parent / "alias.mp4").symlink_to(self.media)
        with self.assertRaisesRegex(ValueError, "symlink"):
            archive.library_files(self.library)

    def test_external_reference_rejected(self):
        self.xml.write_text(self.xml.read_text().replace(self.media.as_uri(), self.xml.as_uri()))
        with self.assertRaisesRegex(ValueError, "external media"):
            archive.managed_xml(self.xml, self.library)

    def test_unreferenced_media_rejected(self):
        (self.media.parent / "unused.mp4").write_bytes(b"unused")
        with self.assertRaisesRegex(ValueError, "dependency set differ"):
            self.build()

    def test_open_library_rejected(self):
        with patch.object(archive.subprocess, "run") as run:
            run.return_value.returncode = 0
            run.return_value.stdout = "1234"
            run.return_value.stderr = ""
            with self.assertRaisesRegex(ValueError, "Close the source library"):
                archive.check_closed(archive.library_files(self.library))

    def test_round_trip(self):
        self.build()
        manifest = archive.verify()
        self.assertEqual(manifest["mediaCount"], 1)
        destination = self.root / "restored"
        archive.restore(destination)
        restored = destination / archive.BUNDLE / self.media.relative_to(self.library)
        self.assertEqual(restored.read_bytes(), self.media.read_bytes())
        xml = ET.parse(destination / "project-relinked.fcpxml")
        self.assertEqual(xml.find(".//media-rep").get("src"), restored.as_uri())

    def test_damaged_payload_rejected(self):
        self.build()
        (self.final / "rex-demo.mp4").write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "Changed or missing"):
            archive.verify()

    def test_damaged_member_manifest_rejected(self):
        self.build()
        path = self.final / "manifest.json"
        manifest = json.loads(path.read_text())
        manifest["archiveMembers"][0]["sha256"] = "0" * 64
        path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, "Archive content mismatch"):
            archive.verify()

    def test_overwrite_refused(self):
        self.build()
        with self.assertRaisesRegex(ValueError, "Refusing to overwrite"):
            self.build()
        with self.assertRaisesRegex(ValueError, "destination must be new"):
            archive.restore(self.root)

    def test_build_without_old_production_folders(self):
        output = self.root / "new-delivery"
        archive.build(self.library, self.xml, self.inputs, output)
        manifest = archive.verify(output)
        self.assertEqual(manifest["mediaCount"], 1)
        self.assertEqual((output / "rex-demo.mp4").read_bytes(),
                         (self.inputs / "rex-demo.mp4").read_bytes())
        with self.assertRaisesRegex(ValueError, "output must be a new directory"):
            archive.build(self.library, self.xml, self.inputs, output)

    def test_build_input_cannot_be_output(self):
        with self.assertRaisesRegex(ValueError, "must be separate"):
            archive.build(self.library, self.xml, self.inputs, self.inputs)

    def test_missing_inputs_leave_no_partial_archive(self):
        (self.inputs / "source/captions.itt").rename(self.inputs / "withheld.itt")
        output = self.root / "new-delivery"
        with self.assertRaisesRegex(ValueError, "Missing build input"):
            archive.build(self.library, self.xml, self.inputs, output)
        self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
