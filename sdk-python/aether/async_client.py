"""Asynchronous Aether OS client.

Provides ``AetherAsyncClient``, an async wrapper around the Aether OS
REST API v1 using :mod:`httpx` with ``AsyncClient``.
"""

from __future__ import annotations

from typing import Any, AsyncIterator

import httpx

from aether.exceptions import AetherError
from aether.events import subscribe_events_async
from aether.namespaces import (
    AsyncAgentsNamespace,
    AsyncCronNamespace,
    AsyncFSNamespace,
    AsyncIntegrationsNamespace,
    AsyncMarketplaceNamespace,
    AsyncOrgsNamespace,
    AsyncPluginsNamespace,
    AsyncSystemNamespace,
    AsyncTemplatesNamespace,
    AsyncTriggersNamespace,
    AsyncWebhooksNamespace,
)


class _AsyncEventsAccessor:
    """Thin accessor so ``client.events.subscribe(...)`` mirrors the TS SDK."""

    def __init__(self, base_url: str, get_token: Any) -> None:
        self._base_url = base_url
        self._get_token = get_token

    def subscribe(
        self, filter: list[str] | None = None
    ) -> AsyncIterator[dict[str, Any]]:
        """Open an SSE connection and yield parsed events asynchronously.

        Args:
            filter: Optional list of event types to subscribe to.

        Returns:
            An async iterator of event dictionaries.
        """
        return subscribe_events_async(
            self._base_url,
            token=self._get_token(),
            filter=filter,
        )


class AetherAsyncClient:
    """Asynchronous client for the Aether OS REST API.

    Usage::

        import asyncio
        from aether import AetherAsyncClient

        async def main():
            async with AetherAsyncClient("http://localhost:3000") as client:
                await client.login("admin", "password")
                agents = await client.agents.list()
                print(agents)

        asyncio.run(main())

    Args:
        base_url: Root URL of the Aether OS server.
        token: Optional bearer token. Can also be set later via
            :meth:`login` or :meth:`set_token`.
        timeout: HTTP request timeout in seconds. Defaults to 30.
    """

    def __init__(
        self,
        base_url: str,
        token: str | None = None,
        *,
        timeout: float = 30.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._token: str | None = token
        self._http = httpx.AsyncClient(
            base_url=self._base_url,
            timeout=timeout,
        )

        # Namespace accessors
        self.agents = AsyncAgentsNamespace(self)
        self.fs = AsyncFSNamespace(self)
        self.templates = AsyncTemplatesNamespace(self)
        self.system = AsyncSystemNamespace(self)
        self.events = _AsyncEventsAccessor(self._base_url, lambda: self._token)
        self.cron = AsyncCronNamespace(self)
        self.triggers = AsyncTriggersNamespace(self)
        self.orgs = AsyncOrgsNamespace(self)
        self.marketplace = AsyncMarketplaceNamespace(self)
        self.integrations = AsyncIntegrationsNamespace(self)
        self.webhooks = AsyncWebhooksNamespace(self)
        self.plugins = AsyncPluginsNamespace(self)

    # -- Context manager ----------------------------------------------------

    async def __aenter__(self) -> AetherAsyncClient:
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.close()

    async def close(self) -> None:
        """Close the underlying async HTTP connection pool."""
        await self._http.aclose()

    # -- Authentication -----------------------------------------------------

    async def login(self, username: str, password: str) -> dict[str, Any]:
        """Authenticate and store the returned bearer token.

        Args:
            username: Login username.
            password: Login password.

        Returns:
            Response dict containing ``token`` and ``user`` keys.

        Raises:
            AetherError: If authentication fails.
        """
        result = await self._post(
            "/api/auth/login",
            json={"username": username, "password": password},
        )
        if isinstance(result, dict) and "token" in result:
            self._token = result["token"]
        return result

    def set_token(self, token: str) -> None:
        """Manually set the bearer token for subsequent requests.

        Args:
            token: The bearer token string.
        """
        self._token = token

    # -- Internal HTTP helpers ----------------------------------------------

    def _headers(self) -> dict[str, str]:
        """Build common request headers."""
        headers: dict[str, str] = {}
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        return headers

    def _handle_response(self, response: httpx.Response) -> Any:
        """Process an HTTP response, raising on errors.

        On success, returns ``response.json()["data"]`` if the body contains
        a ``data`` key, otherwise returns the full parsed JSON.
        """
        if not response.is_success:
            parsed: dict[str, Any] | None = None
            try:
                parsed = response.json()
            except Exception:
                parsed = None

            message = (
                parsed.get("error", {}).get("message")
                if isinstance(parsed, dict)
                else None
            ) or f"HTTP {response.status_code}: {response.reason_phrase}"

            code = (
                parsed.get("error", {}).get("code")
                if isinstance(parsed, dict)
                else None
            ) or f"HTTP_{response.status_code}"

            raise AetherError(message, code=code, status=response.status_code)

        data = response.json()
        if isinstance(data, dict) and "data" in data:
            return data["data"]
        return data

    async def _get(self, path: str, *, params: dict[str, Any] | None = None) -> Any:
        """Send an async GET request."""
        response = await self._http.get(path, params=params, headers=self._headers())
        return self._handle_response(response)

    async def _post(self, path: str, *, json: Any | None = None) -> Any:
        """Send an async POST request."""
        response = await self._http.post(path, json=json, headers=self._headers())
        return self._handle_response(response)

    async def _put(self, path: str, *, json: Any) -> Any:
        """Send an async PUT request."""
        response = await self._http.put(path, json=json, headers=self._headers())
        return self._handle_response(response)

    async def _patch(self, path: str, *, json: Any) -> Any:
        """Send an async PATCH request."""
        response = await self._http.patch(path, json=json, headers=self._headers())
        return self._handle_response(response)

    async def _delete(self, path: str) -> Any:
        """Send an async DELETE request."""
        response = await self._http.delete(path, headers=self._headers())
        return self._handle_response(response)
