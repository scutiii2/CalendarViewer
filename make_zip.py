"""Create a portable source ZIP using only Python's standard library."""

import argparse
import os
from pathlib import Path
import tempfile
from zipfile import ZIP_DEFLATED, ZipFile


EXCLUDED_DIRS = {
    '.git', '.hg', '.svn', '.codex', '.agents', '.idea', '.vscode',
    '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache',
    '.cache', 'node_modules', '.venv', 'venv', 'dist', 'build',
    'coverage', 'htmlcov', 'secrets', '.secrets',
}
EXCLUDED_SUFFIXES = {'.pyc', '.pyo', '.log', '.tmp', '.temp', '.zip', '.ics', '.pem', '.key'}


def excluded(name):
    lower = name.lower()
    return (
        lower in EXCLUDED_DIRS
        or lower.startswith(('.git', '.env'))
        or lower in {'feeds.json', '.ds_store', 'thumbs.db', 'desktop.ini'}
        or lower.endswith('~')
        or Path(lower).suffix in EXCLUDED_SUFFIXES
    )


def create_zip(root, output):
    root, output = Path(root).resolve(), Path(output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    # Replace the previous archive only after the new one is complete.
    fd, temporary = tempfile.mkstemp(prefix='calendar-package-', suffix='.tmp', dir=output.parent)
    os.close(fd)
    temporary = Path(temporary)
    try:
        with ZipFile(temporary, 'w', compression=ZIP_DEFLATED, compresslevel=9) as archive:
            for directory, folders, files in os.walk(root, followlinks=False):
                folders[:] = sorted(
                    name for name in folders
                    if not excluded(name) and not (Path(directory) / name).is_symlink()
                )
                for name in sorted(files):
                    path = Path(directory) / name
                    if excluded(name) or path.is_symlink() or path.resolve() in {output, temporary}:
                        continue
                    archive.write(path, Path(root.name) / path.relative_to(root))
                    count += 1
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
    return count


def main():
    root = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=root / 'dist' / (root.name + '.zip'))
    args = parser.parse_args()
    count = create_zip(root, args.output)
    print(f'Created {args.output.resolve()} ({count} files)')
    print('Excluded Git files, dependencies, build output, caches, local settings, feeds.json, and ICS files.')


if __name__ == '__main__':
    main()
