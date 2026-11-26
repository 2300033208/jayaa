"""Administration commands.

    python -m engine.manage migrate
    python -m engine.manage create-user --email you@lab.org --name "Your Name"
    python -m engine.manage set-password --email you@lab.org
    python -m engine.manage import-legacy --email you@lab.org [--source DIR]

The database is chosen as for the server: DATABASE_URL, else SQLite in ENGINE_DATA_DIR (default engine/data).
Passwords are read without echo (or from standard input with --password-stdin), never from arguments.
"""

from __future__ import annotations

import argparse
import getpass
import sys
from pathlib import Path

from . import auth
from .api_common import load_settings
from .store import EmailTaken, Store


def _password(from_stdin: bool, email: str) -> str:
    if from_stdin:
        password = sys.stdin.readline().rstrip("\r\n")
    else:
        password = getpass.getpass("Password: ")
        if getpass.getpass("Repeat password: ") != password:
            raise SystemExit("Passwords do not match.")
    problem = auth.password_error(password, email)
    if problem:
        raise SystemExit(problem)
    return password


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m engine.manage", description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("migrate", help="create or upgrade the database schema")
    create = sub.add_parser("create-user", help="create an account (works when self sign-up is disabled)")
    create.add_argument("--email", required=True)
    create.add_argument("--name", required=True)
    create.add_argument("--password-stdin", action="store_true")
    reset = sub.add_parser("set-password", help="set an account's password and end its sessions")
    reset.add_argument("--email", required=True)
    reset.add_argument("--password-stdin", action="store_true")
    legacy = sub.add_parser("import-legacy", help="copy experiments saved by version 1 (JSON files) into an account")
    legacy.add_argument("--email", required=True)
    legacy.add_argument("--source", help="folder with experiments/, simulations/ and studies/ (default: data dir)")
    args = parser.parse_args(argv)

    settings = load_settings()
    store = Store(settings.database_url)
    try:
        if args.command == "migrate":
            print("Database schema is up to date.")
            return 0
        email = auth.normalize_email(args.email)
        if args.command == "create-user":
            for problem in (auth.email_error(email), auth.name_error(args.name.strip())):
                if problem:
                    raise SystemExit(problem)
            password = _password(args.password_stdin, email)
            try:
                user = store.create_user(email, args.name.strip(), auth.hash_password(password))
            except EmailTaken:
                raise SystemExit(f"An account for {email} already exists.") from None
            print(f"Created account {user['email']}.")
            return 0
        user = store.user_by_email(email)
        if user is None:
            raise SystemExit(f"No account for {email}. Create it first with create-user.")
        if args.command == "set-password":
            store.set_password(user["id"], auth.hash_password(_password(args.password_stdin, email)))
            store.delete_sessions_for(user["id"])
            print(f"Password changed; all sessions of {email} ended.")
            return 0
        source = settings.data_dir if args.source is None else Path(args.source)
        counts = store.import_legacy_files(source, user["id"])
        print(f"Imported {counts['experiments']} experiments, {counts['simulations']} runs and {counts['studies']} "
              f"studies into {email} ({counts['skipped']} skipped: already present or unreadable).")
        return 0
    finally:
        store.close()


if __name__ == "__main__":
    raise SystemExit(main())
