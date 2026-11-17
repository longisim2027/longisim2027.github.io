"""Pack the PCUB backend (Python sources + verified assets) into a deterministic zip.

Usage: python tools/make_bundle.py <pcub-checkout> <out-dir>
Prints the bundle file name. Files are stored byte-for-byte (the backend checks
SHA-256 of every asset at startup), sorted, with fixed timestamps, so the same
checkout always yields the same bundle and bundle id.
"""
import hashlib
import sys
import zipfile
from pathlib import Path

FIXED_TIME = (2026, 1, 1, 0, 0, 0)


def entries(backend: Path, tools: Path):
    for p in sorted((backend / "src" / "demo_backend").rglob("*.py")):
        yield p, "src/" + p.relative_to(backend / "src").as_posix()
    for p in sorted((backend / "assets").rglob("*")):
        if p.is_file():
            yield p, "assets/" + p.relative_to(backend / "assets").as_posix()
    yield tools / "browser_bridge.py", "browser_bridge.py"


def main() -> None:
    pcub, out = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    backend, tools = pcub / "backend", Path(__file__).resolve().parent
    items = list(entries(backend, tools))
    digest = hashlib.sha256()
    for src, name in items:
        digest.update(name.encode() + b"\0" + hashlib.sha256(src.read_bytes()).digest())
    bundle_id = digest.hexdigest()[:12]
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("backend-*.zip"):
        old.unlink()
    target = out / f"backend-{bundle_id}.zip"
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for src, name in items:
            info = zipfile.ZipInfo(name, FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, src.read_bytes())
    print(f"{target.name} {bundle_id} {len(items)}")


if __name__ == "__main__":
    main()
