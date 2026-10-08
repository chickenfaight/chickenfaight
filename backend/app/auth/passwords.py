"""Password hashing with scrypt (standard library). Passwords arrive in plain text over HTTPS and are
hashed only here; the client never hashes, since a client-side hash would itself become the password."""

import hashlib
import hmac
import secrets

# OWASP-recommended scrypt cost (N=2^17, r=8, p=1) uses 128 MiB; this uses 16 MiB for a small server.
_N, _R, _P, _LENGTH = 2**14, 8, 1, 32


def _derive(password: str, salt: bytes) -> bytes:
    return hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=_LENGTH)


def hash_password(password: str) -> tuple[str, str]:
    """A new random salt and the password's hash, both hex, for `users.password_salt`/`password_hash`."""
    salt = secrets.token_bytes(16)
    return salt.hex(), _derive(password, salt).hex()


def verify_password(password: str, salt: str | None, expected: str | None) -> bool:
    """Constant-time check. Without a stored hash (unknown user or Google-only account) it still does
    the same work against a dummy, so response time doesn't reveal whether the account exists."""
    if salt is None or expected is None:
        _derive(password, b"\0" * 16)
        return False
    return hmac.compare_digest(_derive(password, bytes.fromhex(salt)).hex(), expected)
