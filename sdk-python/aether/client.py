"""Synchronous Aether OS client.

Provides ``AetherClient``, a fully synchronous wrapper around the
Aether OS REST API v1 using :mod:`httpx`.
"""

from __future__ import annotations

from typing import Any

import httpx

from aether.exceptions import AetherError
from aether.events import subscribe_events
from aether.namespaces import (
    AgentsNamespace,
    CronNamespace,
    FSNamespace,
    IntegrationsNamespace,
    MarketplaceNamespace,
    OrgsNamespace,
    PluginsNamespace,
    SystemNamespace,
    TemplatesNamespace,
    TriggersNamespace,
    WebhooksNamespace,
)


class _EventsAccessor:
    """Thin accessor so ``client.events.subscribe(...)`` mirrors the TS SDK."""

    def __init__(self, base_url: str, get_token: Any) -> None:
        self._base_url = base_url
        self._get_token = get_token

    def subscribe(self, filter: list[str] | None = None):
        """Open an SSE connection and yield parsed events.

        Args:
            filter: Optional list of event types to subscribe to.

        Returns:
            A synchronous iterator of event dictionaries.
        """
        return subscribe_events(
            self._base_url,
            token=self._get_token(),
            filter=filter,
        )


class AetherClient:
    """Synchronous client for the Aether OS REST API.

    Usage::

        from aether import AetherClient

        client = AetherClient("http://localhost:3000", token="my-token")
        agents = client.agents.list()
        status = client.system.status()

    The client manages its own :class:`httpx.Client` instance. Use it as a
    context manager to ensure the underlying connection pool is closed
    promptly::

        with AetherClient("http://localhost:3000") as client:
            client.login("admin", "password")
            print(client.agents.list())

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
        self._http = httpx.Client(
            base_url=self._base_url,
            timeout=timeout,
        )

        # Namespace accessors
        self.agents = AgentsNamespace(self)
        self.fs = FSNamespace(self)
        self.templates = TemplatesNamespace(self)
        self.system = SystemNamespace(self)
        self.events = _EventsAccessor(self._base_url, lambda: self._token)
        self.cron = CronNamespace(self)
        self.triggers = TriggersNamespace(self)
        self.orgs = OrgsNamespace(self)
        self.marketplace = MarketplaceNamespace(self)
        self.integrations = IntegrationsNamespace(self)
        self.webhooks = WebhooksNamespace(self)
        self.plugins = PluginsNamespace(self)

    # -- Context manager ----------------------------------------------------

    def __enter__(self) -> AetherClient:
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()

    def close(self) -> None:
        """Close the underlying HTTP connection pool."""
        self._http.close()

    # -- Authentication -----------------------------------------------------

    def login(self, username: str, password: str) -> dict[str, Any]:
        """Authenticate and store the returned bearer token.

        Args:
            username: Login username.
            password: Login password.

        Returns:
            Response dict containing ``token`` and ``user`` keys.

        Raises:
            AetherError: If authentication fails.
        """
        result = self._post(
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
            body_text = response.text
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

    def _get(self, path: str, *, params: dict[str, Any] | None = None) -> Any:
        """Send a GET request."""
        response = self._http.get(path, params=params, headers=self._headers())
        return self._handle_response(response)

    def _post(self, path: str, *, json: Any | None = None) -> Any:
        """Send a POST request."""
        response = self._http.post(path, json=json, headers=self._headers())
        return self._handle_response(response)

    def _put(self, path: str, *, json: Any) -> Any:
        """Send a PUT request."""
        response = self._http.put(path, json=json, headers=self._headers())
        return self._handle_response(response)

    def _patch(self, path: str, *, json: Any) -> Any:
        """Send a PATCH request."""
        response = self._http.patch(path, json=json, headers=self._headers())
        return self._handle_response(response)

    def _delete(self, path: str) -> Any:
        """Send a DELETE request."""
        response = self._http.delete(path, headers=self._headers())
        return self._handle_response(response)
