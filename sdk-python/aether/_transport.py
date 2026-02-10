"""Transport protocol definitions for namespace type checking.

These protocols define the internal HTTP method signatures that namespace
classes depend on. They are used only for static type checking and are
not instantiated at runtime.
"""

from __future__ import annotations

from typing import Any, Protocol


class SyncTransport(Protocol):
    """Protocol for synchronous HTTP transport methods."""

    def _get(self, path: str, *, params: dict[str, Any] | None = None) -> Any: ...

    def _post(self, path: str, *, json: Any | None = None) -> Any: ...

    def _put(self, path: str, *, json: Any) -> Any: ...

    def _patch(self, path: str, *, json: Any) -> Any: ...

    def _delete(self, path: str) -> Any: ...


class AsyncTransport(Protocol):
    """Protocol for asynchronous HTTP transport methods."""

    async def _get(self, path: str, *, params: dict[str, Any] | None = None) -> Any: ...

    async def _post(self, path: str, *, json: Any | None = None) -> Any: ...

    async def _put(self, path: str, *, json: Any) -> Any: ...

    async def _patch(self, path: str, *, json: Any) -> Any: ...

    async def _delete(self, path: str) -> Any: ...
