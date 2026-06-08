"""Symmetric encryption for stored Archipelago slot passwords.

Uses Fernet (AES-128-CBC + HMAC-SHA256) keyed by `DIGIPELAGO_CRED_KEY`, which
must be a urlsafe-base64-encoded 32-byte key. Generate one with:

    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

The key is read lazily so importing this module never fails when the env is
unset (e.g. during `py_compile` or unit-test collection).
"""

import os

from cryptography.fernet import Fernet


def _fernet() -> Fernet:
    key = os.environ.get("DIGIPELAGO_CRED_KEY", "")
    if not key:
        raise RuntimeError("DIGIPELAGO_CRED_KEY is not set")
    # Fernet accepts str or bytes; normalize to bytes.
    return Fernet(key.encode() if isinstance(key, str) else key)


def encrypt(plaintext: str) -> bytes:
    """Encrypt a UTF-8 string, returning the Fernet token as bytes (-> bytea)."""
    return _fernet().encrypt(plaintext.encode("utf-8"))


def decrypt(token: bytes) -> str:
    """Decrypt a Fernet token (bytes from a bytea column) back to a string."""
    if isinstance(token, memoryview):
        token = token.tobytes()
    elif isinstance(token, str):
        token = token.encode("utf-8")
    return _fernet().decrypt(token).decode("utf-8")
