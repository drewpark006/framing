#!/usr/bin/env python3
"""
hash_password.py — Generate a SHOP_PASS_HASH for Verso.

Reads a password from stdin via getpass (no echo) and prints a scrypt hash
string in the format expected by serve.py:

    scrypt$<n>$<r>$<p>$<salt_b64>$<hash_b64>

Usage:
    python3 scripts/hash_password.py
    # paste/type password, then:
    fly secrets set SHOP_PASS_HASH=<output>
"""

import base64
import getpass
import hashlib
import os
import sys


# Match defaults used in serve.py's verify_password.
SCRYPT_N = 2 ** 14
SCRYPT_R = 8
SCRYPT_P = 1
SALT_BYTES = 16
DK_LEN = 32


def hash_password(password: str) -> str:
    salt = os.urandom(SALT_BYTES)
    dk = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=SCRYPT_N,
        r=SCRYPT_R,
        p=SCRYPT_P,
        dklen=DK_LEN,
    )
    return "scrypt${n}${r}${p}${salt}${hash}".format(
        n=SCRYPT_N,
        r=SCRYPT_R,
        p=SCRYPT_P,
        salt=base64.b64encode(salt).decode("ascii"),
        hash=base64.b64encode(dk).decode("ascii"),
    )


def main() -> int:
    try:
        pw1 = getpass.getpass("password: ")
        pw2 = getpass.getpass("confirm:  ")
    except (EOFError, KeyboardInterrupt):
        print("\naborted", file=sys.stderr)
        return 1
    if not pw1:
        print("error: empty password", file=sys.stderr)
        return 1
    if pw1 != pw2:
        print("error: passwords do not match", file=sys.stderr)
        return 1
    print(hash_password(pw1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
