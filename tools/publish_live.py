"""Publish the deployment-only files of a source ref to the `live` branch.

Builds a commit from the paths in DEPLOY_PATHS using a temporary git index, so
your working tree, index and current branch are never touched. The commit's
parent is the remote `live` tip, so the push is a normal fast-forward.

Each publish is a release named by the VERSION file: the source commit is tagged
vX.Y.Z and the live commit live-vX.Y.Z. If the live files did not change, nothing
is pushed or tagged. Changing them without bumping VERSION is refused.

    python tools/publish_live.py              # publish main
    python tools/publish_live.py --dry-run    # show what would be published
    python tools/publish_live.py --source HEAD
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tempfile
from pathlib import Path

# Everything the image builds from and the compose file that runs it. Add a path here when a service is added.
DEPLOY_PATHS = [
    "Dockerfile",
    "docker-compose.yml",
    "VERSION",
    "src",
    "vendor",
    "README.md",
]
BRANCH = "live"
REMOTE = "origin"
ROOT = Path(__file__).resolve().parent.parent


def git(*args: str, env: dict | None = None, stdin: str | None = None) -> str:
    # Bytes in and out: text mode would turn "\n" into "\r\n" on Windows and corrupt the index entries.
    result = subprocess.run(
        ["git", *args], cwd=ROOT, env=env, input=stdin.encode() if stdin else None, capture_output=True
    )
    if result.returncode != 0:
        sys.exit(f"git {' '.join(args)} failed:\n{result.stderr.decode(errors='replace').strip()}")
    return result.stdout.decode(errors="replace").strip()


def remote_live_tip() -> str | None:
    """The remote `live` commit, fetched so its tree can be compared; None if the branch does not exist yet."""
    line = git("ls-remote", "--heads", REMOTE, f"refs/heads/{BRANCH}")
    if not line:
        return None
    tip = line.split()[0]
    git("fetch", "--quiet", REMOTE, f"refs/heads/{BRANCH}")
    return tip


def build_tree(source: str) -> str:
    """Write a tree holding only DEPLOY_PATHS from `source`, using a throwaway index."""
    listing = git("ls-tree", "-r", source, "--", *DEPLOY_PATHS)
    if not listing:
        sys.exit(f"None of the deploy paths exist in {source}.")
    present = {line.split("\t", 1)[1] for line in listing.splitlines()}
    for path in DEPLOY_PATHS:
        if not any(p == path or p.startswith(path + "/") for p in present):
            print(f"warning: {path} not found in {source}", file=sys.stderr)
    with tempfile.TemporaryDirectory() as tmp:
        env = {**os.environ, "GIT_INDEX_FILE": str(Path(tmp) / "index")}
        git("update-index", "--add", "--index-info", env=env, stdin=listing + "\n")
        return git("write-tree", env=env)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", default="main", help="ref to publish from (default: main)")
    parser.add_argument("--dry-run", action="store_true", help="build and report, push nothing")
    args = parser.parse_args()

    source_sha = git("rev-parse", "--verify", f"{args.source}^{{commit}}")
    tree = build_tree(source_sha)
    count = len(git("ls-tree", "-r", "--name-only", tree).splitlines())
    parent = remote_live_tip()
    parent_tree = git("rev-parse", f"{parent}^{{tree}}") if parent else None

    print(f"source {args.source} ({source_sha[:8]}) -> {count} files, tree {tree[:8]}")
    if tree == parent_tree:
        print(f"{BRANCH} is already up to date.")
        return

    # A changed live tree is a release: the source commit gets vX.Y.Z, the live commit gets live-vX.Y.Z.
    version = git("show", f"{source_sha}:VERSION").strip()
    source_tag, live_tag = f"v{version}", f"live-v{version}"
    if git("ls-remote", "--tags", REMOTE, f"refs/tags/{live_tag}"):
        sys.exit(f"{live_tag} is already released with a different tree. Bump VERSION, commit, then publish again.")

    subject = git("log", "-1", "--format=%s", source_sha)
    message = f"live: {source_sha[:8]} {subject}"
    if args.dry_run:
        print(f"dry run: would commit '{message}' on top of {parent[:8] if parent else 'nothing (new branch)'}")
        print(f"dry run: would tag {source_sha[:8]} as {source_tag} and the live commit as {live_tag}")
        return

    commit = git("commit-tree", tree, *(["-p", parent] if parent else []), "-m", message)
    # -f moves a local tag that was never pushed; the remote check above guarantees this version is unreleased.
    git("tag", "-f", "-a", source_tag, source_sha, "-m", source_tag)
    git("tag", "-f", "-a", live_tag, commit, "-m", live_tag)
    git("push", REMOTE, f"{commit}:refs/heads/{BRANCH}", f"+refs/tags/{source_tag}", f"refs/tags/{live_tag}")
    print(f"pushed {commit[:8]} to {REMOTE}/{BRANCH}, tags {source_tag} and {live_tag}")


if __name__ == "__main__":
    main()
