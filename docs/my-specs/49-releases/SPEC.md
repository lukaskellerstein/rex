# Spec 49 — Releases

**Status: built 2026-09-07, first run pending.** The workflow exists and is
tested on this machine as far as a workflow can be; its first run on GitHub is
the acceptance test, and §7 says what that run must show.

## 1. What this is

Every merge to `main` produces the five installers REX ships and publishes
them as one GitHub Release, so anyone can download and install REX without a
build machine. Spec 46 §13 made REX installable; this spec makes it
downloadable.

## 2. What was decided, and why

| Decision | Choice | Why |
|:--|:--|:--|
| Trigger | `push` to `main`, which is what a merged pull request produces | The reviewer's words: "when a new commit to main branch (via PR) is merged" |
| Pull requests | build all five, keep them as artifacts for 14 days, publish nothing | The pipeline is exercised before a merge, and a broken build blocks the merge rather than the Release |
| Builders | one GitHub-hosted runner per platform **and** architecture | `bundle-python.mjs` stages the host's CPython and executes it, so there is no cross-build (spec 46 §13). The repo is public, so arm64 runners are free |
| Files | macOS arm64 DMG; Windows x64 and arm64 NSIS; Linux x64 `.deb` and `.rpm` | Windows is mostly x64; Intel Macs are not built; AppImage was dropped on 2026-09-07 (its arm64 launcher does not start, and Ubuntu 24.04+ blocks Electron's sandbox inside one) |
| Tag | `v<package.json version>-<run number>`, for example `v0.1.0-17` | Two merges of the same `version` must not collide, and `version` is a human's decision, never bumped by CI |
| Release body | a fixed install guide, then GitHub's generated list of merged pull requests | People who download need the unsigned-build steps more than a changelog |
| Publisher | `gh release create` in a final job, with the workflow's own token | No third-party action in the path to a public artifact; `gh` is preinstalled on every runner |
| Signing | none | Needs an Apple Developer ID and a Windows certificate — its own spec, as spec 46 §13 said |

## 3. The workflow

`.github/workflows/release.yml`. Four build jobs and one publish job.

| Job | Runner | Command |
|:--|:--|:--|
| macOS arm64 | `macos-latest` | `npm run package -- --mac dmg --arm64` |
| Windows x64 | `windows-latest` | `npm run package -- --win nsis --x64` |
| Windows arm64 | `windows-11-arm` | `npm run package -- --win nsis --arm64` |
| Linux x64 | `ubuntu-latest` | `npm run package -- --linux deb rpm --x64` |

Each job: checkout, Node 22 with the npm cache, `uv` with its cache,
`rpmbuild` on Linux, `npm ci`, the command above, then upload `release/*`.
The publish job runs only for a push to `main`, downloads every artifact and
creates the Release with `--generate-notes` after `.github/release-notes.md`.

The arch flag is stated in every row even though `scripts/package.mjs` would
default to the runner's: a matrix row that disagrees with its runner must fail
loudly, not ship the wrong Python.

## 4. What changed in the repository for this

- **`scripts/package.mjs` defaults the architecture to the host's.**
  `electron-builder.yml` now lists both Windows architectures, so without the
  default `npm run package` on the arm64 VM would also produce an x64
  installer with arm64 Python inside. An explicit flag still wins.
  `REX_PACKAGE_DRY_RUN=1` prints the arguments and exits, for the test.
- **Windows installers carry their architecture in the name**:
  `REX-Setup-0.1.0-x64.exe` and `REX-Setup-0.1.0-arm64.exe`. The default name
  was the same for both, and the second upload would have replaced the first.
- **`package.json` has `author` and `homepage`**, which the `.deb` build needs
  and nothing else did.
- `.github/release-notes.md` is the fixed part of every Release body.

## 5. What the first run must show

The first push to `main` after this spec is the acceptance test. Nothing here
has run on GitHub yet, and three things are known unknowns:

1. Whether the `windows-11-arm` image carries the MSVC ARM64 toolset that
   `better-sqlite3` needs. On the Fusion VM it had to be added by name
   (`Microsoft.VisualStudio.Component.VC.Tools.ARM64`).
2. Whether `ubuntu-latest` has `rpmbuild` after `apt-get install rpm`. It
   should; the step is there because the VM needed it.
3. The Windows x64 installer has never run on x64 hardware. The arm64 VM runs
   x64 programs under emulation, which is where its first install test can
   happen; a native x64 machine is the real test.

## 6. What people get

A Release page with five files and an install guide that says, per platform,
what an unsigned build asks of them: right-click → Open on macOS, "More info →
Run anyway" on Windows, `apt install ./file.deb` or `dnf install ./file.rpm`
on Linux. Every file carries its own Python runtime; nothing else needs to be
installed. That claim was measured on 2026-09-07: the Windows installer ran
from `resources\python\python.exe`, and the Linux `.deb` ran with Node, npm and
uv removed from the machine.

## 7. Acceptance criteria

| # | Criterion |
|:--|:--|
| A1 | A pull request runs the four build jobs and attaches four artifacts; no Release is created |
| A2 | A merge to `main` creates one Release, tagged `v<version>-<run>`, with exactly five files: one DMG, two EXEs, one DEB, one RPM |
| A3 | Each file installs and starts REX on its platform, and both Python children start from the runtime inside it — checked by a person once per platform, on the same VMs as spec 46 |
| A4 | The Release body starts with the install guide and ends with the generated list of pull requests |
| A5 | A second merge of the same `version` creates a second Release rather than failing on the tag |
| A6 | `test/localGateway.spec.ts` guards the workflow's runners, the publish condition, the Windows file names and the host-arch default |

## 8. Out of scope

- Signing and notarisation. Named in spec 46 §13 and still their own job.
- Auto-update inside the app. The `latest*.yml` files electron-builder makes
  are not uploaded.
- Intel Macs. `macos-15-intel` exists until 2027 and is one matrix row away.
- Linux arm64 packages. Built and proven in the VM with `--arm64`; not shipped
  until someone asks.
- A version bump on merge. `version` in package.json stays a human decision.
