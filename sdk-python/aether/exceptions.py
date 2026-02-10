"""Exception classes for the Aether OS SDK."""

from __future__ import annotations


class AetherError(Exception):
    """Raised when an Aether OS API request fails.

    Attributes:
        code: Machine-readable error code (e.g. ``"AGENT_NOT_FOUND"``
            or ``"HTTP_404"``).
        status: HTTP status code of the response.
        message: Human-readable error description.
    """

    def __init__(self, message: str, *, code: str, status: int) -> None:
        super().__init__(message)
        self.code = code
        self.status = status
        self.message = message

    def __repr__(self) -> str:
        return (
            f"AetherError(code={self.code!r}, status={self.status}, "
            f"message={self.message!r})"
        )

    def __str__(self) -> str:
        return f"[{self.code}] {self.message} (HTTP {self.status})"
