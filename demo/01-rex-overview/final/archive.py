"""Package, verify, and restore a closed, media-consolidated Final Cut library.

No third-party packages, Git writes, or changes to the input library. Run with
--help; README.md describes the native consolidation and review steps.
"""

import argparse
from contextlib import closing
import hashlib
import json
import shutil
import sqlite3
import stat
import subprocess
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path, PurePosixPath
from urllib.parse import quote, unquote, urlparse

FINAL = Path(__file__).resolve().parent
BUNDLE = "rex-demo.fcpbundle"
ZIP_NAME = f"{BUNDLE}.zip"
CORE_NAMES = {"CurrentVersion.flexolibrary", "CurrentVersion.plist", "Settings.plist", "Effects.map"}
EXCLUDED = {"Render Files", "Transcoded Media", "Shared Items", "__Trash", "Backups"}
SOURCE_NAMES = (
    "storyboard.json", "timeline.json", "captions.itt", "music-master.mp3",
    "music-config.json", "music-measurement.json",
    "label-backing-chapter.png", "label-backing-ordinary.png",
)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def record(path: str, data: bytes) -> dict:
    return {"path": path, "bytes": len(data), "sha256": digest(data)}


def safe_member(name: str) -> PurePosixPath:
    path = PurePosixPath(name)
    require(not path.is_absolute() and ".." not in path.parts and "\\" not in name,
            f"Unsafe archive path: {name}")
    require(bool(path.parts) and path.parts[0] == BUNDLE, f"Unexpected archive root: {name}")
    return path


def included(relative: Path) -> bool:
    if any(part in EXCLUDED or part.startswith(".") for part in relative.parts):
        return False
    return (len(relative.parts) == 1 and relative.name in CORE_NAMES
            or relative.name == "CurrentVersion.fcpevent"
            or "Original Media" in relative.parts)


def library_files(library: Path) -> list[Path]:
    require(library.is_dir() and library.suffix == ".fcpbundle", "Expected a native library")
    files = sorted(p for p in library.rglob("*") if included(p.relative_to(library)) and not p.is_dir())
    require(any(p.name == "CurrentVersion.flexolibrary" for p in files), "Missing library database")
    require(any(p.name == "CurrentVersion.fcpevent" for p in files), "Missing event database")
    for path in files:
        require(not path.is_symlink(), f"Consolidate media first: symlink {path.name}")
        require(path.is_file(), f"Not a regular file: {path.name}")
    return files


def check_closed(files: list[Path]) -> None:
    databases = [p for p in files if p.suffix in {".fcpevent", ".flexolibrary"}]
    result = subprocess.run(["lsof", "-t", *map(str, databases)], capture_output=True, text=True)
    require(result.returncode == 1 and not result.stdout.strip() and not result.stderr.strip(),
            "Close the source library in Final Cut before packaging (or check lsof availability)")
    for path in databases:
        for suffix in ("-wal", "-journal"):
            journal = Path(str(path) + suffix)
            require(not journal.exists() or journal.stat().st_size == 0, "Uncheckpointed database")
        with closing(sqlite3.connect(f"{path.as_uri()}?mode=ro&immutable=1", uri=True)) as database:
            require(database.execute("PRAGMA quick_check").fetchall() == [("ok",)],
                    f"Database integrity check failed: {path.name}")


def managed_xml(xml_path: Path, library: Path) -> tuple[ET.ElementTree, set[Path]]:
    tree = ET.parse(xml_path)
    require(len(tree.findall(".//project")) == 1, "Archive must contain exactly one final project")
    media: set[Path] = set()
    for element in tree.findall(".//asset/media-rep"):
        uri = urlparse(element.attrib["src"])
        require(uri.scheme == "file" and uri.netloc in {"", "localhost"}, "Expected local media")
        path = Path(unquote(uri.path)).resolve()
        require(path.is_relative_to(library), "Native XML still references external media")
        relative = path.relative_to(library)
        require("Original Media" in relative.parts and path.is_file(), "Media is not consolidated")
        media.add(path)
        element.set("src", "../" + BUNDLE + "/" + quote(relative.as_posix()))
    for parent in tree.iter():
        for child in list(parent):
            if child.tag == "bookmark":
                parent.remove(child)
    for element in tree.findall(".//library"):
        element.attrib.pop("location", None)
    return tree, media


def build(library: Path, native_xml: Path, inputs: Path, output: Path | None = None) -> None:
    destination = output.resolve() if output is not None else FINAL
    inputs = inputs.resolve()
    require(inputs != destination, "Build inputs and output must be separate")
    library = library.resolve()
    files = library_files(library)
    check_closed(files)
    tree, referenced = managed_xml(native_xml, library)
    actual = {p.resolve() for p in files if "Original Media" in p.relative_to(library).parts}
    require(actual == referenced, "Library media and exported dependency set differ")
    for path in (inputs / "rex-demo.mp4", *(inputs / "source" / name for name in SOURCE_NAMES)):
        require(path.is_file(), f"Missing build input: {path}")
    if output is not None:
        require(not destination.exists(), "Build output must be a new directory")
    for path in (destination / ZIP_NAME, destination / "rex-demo.mp4", destination / "manifest.json"):
        require(not path.exists(), f"Refusing to overwrite {path.name}; preserve the previous archive first")
    source = destination / "source"
    source.mkdir(parents=True, exist_ok=True)
    entries = []
    with zipfile.ZipFile(destination / ZIP_NAME, "x", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in files:
            name = BUNDLE + "/" + path.relative_to(library).as_posix()
            data = path.read_bytes()
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            archive.writestr(info, data)
            entries.append(record(name, data))
    shutil.copyfile(inputs / "rex-demo.mp4", destination / "rex-demo.mp4")
    for name in SOURCE_NAMES:
        shutil.copyfile(inputs / "source" / name, source / name)
    tree.write(source / "project.fcpxml", encoding="utf-8", xml_declaration=True)
    effects = [{"name": e.get("name"), "uid": e.get("uid")} for e in tree.findall("./resources/effect")]
    fonts = sorted({(e.get("font", ""), e.get("fontFace", ""))
                    for e in tree.findall(".//text-style") if e.get("font")})
    timeline = json.loads((source / "timeline.json").read_text())
    payloads = [destination / ZIP_NAME, destination / "rex-demo.mp4", *sorted(source.iterdir())]
    manifest = {
        "schemaVersion": 1,
        "approvedDate": "2026-09-14",
        "project": "REX — Ask where the work lives — Revision 5",
        "authoritativeEditor": "Final Cut Pro Creator Studio 12.3 (450152)",
        "videoFrames": timeline["durationInFrames"],
        "fps": timeline["fps"],
        "libraryArchive": ZIP_NAME,
        "mediaCount": len(actual),
        "mediaBytes": sum(p.stat().st_size for p in actual),
        "files": [record(p.relative_to(destination).as_posix(), p.read_bytes()) for p in payloads],
        "archiveMembers": entries,
        "effects": effects,
        "fonts": [{"family": family, "face": face} for family, face in fonts],
        "externalRequirements": ["Final Cut Pro", "Installed motionVFX DesignStudio templates", "Listed fonts"],
        "excluded": sorted(EXCLUDED) + ["locks", "journals", "old versions", "third-party templates and fonts"],
    }
    (destination / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    verify(destination)


def verify(directory: Path | None = None) -> dict:
    directory = directory.resolve() if directory is not None else FINAL
    manifest = json.loads((directory / "manifest.json").read_text())
    for item in manifest["files"]:
        path = (directory / item["path"]).resolve()
        require(path.is_relative_to(directory), "Manifest path escapes archive folder")
        require(record(item["path"], path.read_bytes()) == item, f"Changed or missing: {item['path']}")
    expected = {item["path"]: item for item in manifest["archiveMembers"]}
    with zipfile.ZipFile(directory / ZIP_NAME) as archive:
        require(len(archive.infolist()) == len(expected), "Duplicate or missing archive members")
        require(set(archive.namelist()) == set(expected), "Unexpected archive members")
        for info in archive.infolist():
            safe_member(info.filename)
            require(not stat.S_ISLNK(info.external_attr >> 16), "Symlinks are not allowed in archive")
            require(record(info.filename, archive.read(info)) == expected[info.filename],
                    f"Archive content mismatch: {info.filename}")
    print(f"Verified {len(manifest['files'])} payload files, {len(expected)} library files, "
          f"{manifest['mediaCount']} media assets; {manifest['videoFrames']} frames.")
    return manifest


def restore(destination: Path) -> None:
    manifest = verify()
    destination = destination.resolve()
    require(not destination.exists(), "Restore destination must be new; never overwrite a working library")
    destination.mkdir(parents=True)
    with zipfile.ZipFile(FINAL / ZIP_NAME) as archive:
        for info in archive.infolist():
            path = destination.joinpath(*safe_member(info.filename).parts)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(archive.read(info))
    for item in manifest["archiveMembers"]:
        require(digest((destination / item["path"]).read_bytes()) == item["sha256"], "Restore mismatch")
    tree = ET.parse(FINAL / "source/project.fcpxml")
    for element in tree.findall(".//asset/media-rep"):
        relative = unquote(element.attrib["src"])
        require(relative.startswith("../" + BUNDLE + "/"), "Unexpected relative media URL")
        path = destination.joinpath(*safe_member(relative[3:]).parts)
        element.set("src", path.as_uri())
    tree.write(destination / "project-relinked.fcpxml", encoding="utf-8", xml_declaration=True)
    print(f"Restored {destination / BUNDLE}; open the native library, not the XML fallback.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    make = commands.add_parser("build", help="Package a closed, consolidated native library")
    make.add_argument("--library", type=Path, required=True)
    make.add_argument("--native-xml", type=Path, required=True)
    make.add_argument("--inputs", type=Path, required=True,
                      help="Folder containing rex-demo.mp4 and source/ (same layout as this archive)")
    make.add_argument("--output", type=Path, required=True, help="New output folder; never overwrites")
    commands.add_parser("verify", help="Verify every delivered file and archived library member")
    unpack = commands.add_parser("restore", help="Verify and extract to a new working directory")
    unpack.add_argument("destination", type=Path)
    args = parser.parse_args()
    if args.command == "build":
        build(args.library, args.native_xml, args.inputs, args.output)
    elif args.command == "restore":
        restore(args.destination)
    else:
        verify()


if __name__ == "__main__":
    main()
