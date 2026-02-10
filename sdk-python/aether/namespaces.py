"""Namespace classes for the Aether OS SDK.

Each namespace groups related API endpoints and delegates HTTP calls
to the parent client's internal transport methods.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from urllib.parse import quote

if TYPE_CHECKING:
    from aether._transport import SyncTransport, AsyncTransport


# ---------------------------------------------------------------------------
# Sync namespaces
# ---------------------------------------------------------------------------


class AgentsNamespace:
    """Agent lifecycle and interaction endpoints."""

    def __init__(self, transport: SyncTransport) -> None:
        self._t = transport

    def list(
        self,
        *,
        status: str | None = None,
        limit: int | None = None,
        offset: int | None = None,
    ) -> Any:
        """List agents, optionally filtered by status."""
        params: dict[str, Any] = {}
        if status is not None:
            params["status"] = status
        if limit is not None:
            params["limit"] = limit
        if offset is not None:
            params["offset"] = offset
        return self._t._get("/api/v1/agents", params=params)

    def spawn(
        self,
        *,
        role: str,
        goal: str,
        model: str | None = None,
        tools: list[str] | None = None,
        max_steps: int | None = None,
    ) -> Any:
        """Spawn a new agent."""
        body: dict[str, Any] = {"role": role, "goal": goal}
        if model is not None:
            body["model"] = model
        if tools is not None:
            body["tools"] = tools
        if max_steps is not None:
            body["maxSteps"] = max_steps
        return self._t._post("/api/v1/agents", json=body)

    def get(self, uid: str) -> Any:
        """Get agent details by UID."""
        return self._t._get(f"/api/v1/agents/{uid}")

    def kill(self, uid: str) -> Any:
        """Kill (terminate) an agent."""
        return self._t._delete(f"/api/v1/agents/{uid}")

    def message(self, uid: str, content: str) -> Any:
        """Send a message to an agent."""
        return self._t._post(f"/api/v1/agents/{uid}/message", json={"content": content})

    def timeline(
        self,
        uid: str,
        *,
        limit: int | None = None,
        offset: int | None = None,
    ) -> Any:
        """Retrieve an agent's event timeline."""
        params: dict[str, Any] = {}
        if limit is not None:
            params["limit"] = limit
        if offset is not None:
            params["offset"] = offset
        return self._t._get(f"/api/v1/agents/{uid}/timeline", params=params)

    def memory(
        self,
        uid: str,
        *,
        query: str | None = None,
        layer: str | None = None,
        limit: int | None = None,
    ) -> Any:
        """Query an agent's memory layers."""
        params: dict[str, Any] = {}
        if query is not None:
            params["query"] = query
        if layer is not None:
            params["layer"] = layer
        if limit is not None:
            params["limit"] = limit
        return self._t._get(f"/api/v1/agents/{uid}/memory", params=params)

    def plan(self, uid: str) -> Any:
        """Get an agent's current plan."""
        return self._t._get(f"/api/v1/agents/{uid}/plan")

    def profile(self, uid: str) -> Any:
        """Get an agent's profile."""
        return self._t._get(f"/api/v1/agents/{uid}/profile")


class FSNamespace:
    """Virtual filesystem endpoints."""

    def __init__(self, transport: SyncTransport) -> None:
        self._t = transport

    def read(self, path: str) -> Any:
        """Read a file from the virtual filesystem."""
        return self._t._get(f"/api/v1/fs/{quote(path, safe='')}")

    def write(self, path: str, content: str) -> Any:
        """Write content to a file in the virtual filesystem."""
        return self._t._put(f"/api/v1/fs/{quote(path, safe='')}", json={"content": content})

    def delete(self, path: str) -> Any:
        """Delete a file from the virtual filesystem."""
        return self._t._delete(f"/api/v1/fs/{quote(path, safe='')}")


class TemplatesNamespace:
    """Agent template endpoints."""

    def __init__(self, transport: SyncTransport) -> None:
        self._t = transport

    def list(self) -> Any:
        """List all available templates."""
        return self._t._get("/api/v1/templates")

    def get(self, template_id: str) -> Any:
        """Get a template by ID."""
        return self._t._get(f"/api/v1/templates/{template_id}")


class SystemNamespace:
    """System health and metrics endpoints."""

    def __init__(self, transport: SyncTransport) -> None:
        self._t = transport

    def status(self) -> Any:
        """Get the system status."""
        return self._t._get("/api/v1/system/status")

    def metrics(self) -> Any:
        """Get system metrics."""
        return self._t._get("/api/v1/system/metrics")


class CronNamespace:
    """Scheduled task (cron) endpoints."""

    def __init__(self, transport: SyncTransport) -> None:
        self._t = transport

    def list(self) -> Any:
        """List all cron jobs."""
        return self._t._get("/api/v1/cron")

    def create(
        self,
        *,
        name: str,
        expression: str,
        agent_config: Any,
    ) -> Any:
        """Create a new cron job."""
        return self._t._post(
            "/api/v1/cron",
            json={"name": name, "expression": expression, "agent_config": agent_config},
        )

    def delete(self, cron_id: str) -> Any:
        """Delete a cron job."""
        return self._t._delete(f"/api/v1/cron/{cron_id}")

    def update(self, cron_id: str, *, enabled: bool | None = None) -> Any:
        """Update a cron job."""
        body: dict[str, Any] = {}
        if enabled is not None:
            body["enabled"] = enabled
        return self._t._patch(f"/api/v1/cron/{cron_id}", json=body)


class TriggersNamespace:
    """Event trigger endpoints."""

    def __init__(self, transport: SyncTransport) -> None:
        self._t = transport

    def list(self) -> Any:
        """List all triggers."""
        return self._t._get("/api/v1/triggers")

    def create(
        self,
        *,
        name: str,
        event_type: str,
        agent_config: Any,
    ) -> Any:
        """Create a new trigger."""
        return self._t._post(
            "/api/v1/triggers",
            json={"name": name, "event_type": event_type, "agent_config": agent_config},
        )

    def delete(self, trigger_id: str) -> Any:
        """Delete a trigger."""
        return self._t._delete(f"/api/v1/triggers/{trigger_id}")


class _OrgsMembersNamespace:
    """Organization member management (nested under orgs)."""

    def __init__(self, transport: SyncTransport) -> None:
        self._t = transport

    def list(self, org_id: str) -> Any:
        """List members of an organization."""
        return self._t._get(f"/api/v1/orgs/{org_id}/members")

    def invite(self, org_id: str, *, user_id: str, role: str | None = None) -> Any:
        """Invite a user to an organization."""
        body: dict[str, Any] = {"userId": user_id}
        if role is not None:
            body["role"] = role
        return self._t._post(f"/api/v1/orgs/{org_id}/members", json=body)

    def remove(self, org_id: str, user_id: str) -> Any:
        """Remove a member from an organization."""
        return self._t._delete(f"/api/v1/orgs/{org_id}/members/{user_id}")

    def update_role(self, org_id: str, user_id: str, *, role: str) -> Any:
        """Update a member's role within an organization."""
        return self._t._patch(
            f"/api/v1/orgs/{org_id}/members/{user_id}",
            json={"role": role},
        )


class _OrgsTeamsNamespace:
    """Organization team management (nested under orgs)."""

    def __init__(self, transport: SyncTransport) -> None:
        self._t = transport

    def list(self, org_id: str) -> Any:
        """List teams in an organization."""
        return self._t._get(f"/api/v1/orgs/{org_id}/teams")

    def create(self, org_id: str, *, name: str, description: str | None = None) -> Any:
        """Create a team in an organization."""
        body: dict[str, Any] = {"name": name}
        if description is not None:
            body["description"] = description
        return self._t._post(f"/api/v1/orgs/{org_id}/teams", json=body)

    def delete(self, org_id: str, team_id: str) -> Any:
        """Delete a team."""
        return self._t._delete(f"/api/v1/orgs/{org_id}/teams/{team_id}")

    def add_member(
        self,
        org_id: str,
        team_id: str,
        *,
        user_id: str,
        role: str | None = None,
    ) -> Any:
        """Add a member to a team."""
        body: dict[str, Any] = {"userId": user_id}
        if role is not None:
            body["role"] = role
        return self._t._post(
            f"/api/v1/orgs/{org_id}/teams/{team_id}/members",
            json=body,
        )

    def remove_member(self, org_id: str, team_id: str, user_id: str) -> Any:
        """Remove a member from a team."""
        return self._t._delete(
            f"/api/v1/orgs/{org_id}/teams/{team_id}/members/{user_id}"
        )


class OrgsNamespace:
    """Organization and RBAC endpoints."""

    def __init__(self, transport: SyncTransport) -> None:
        self._t = transport
        self.members = _OrgsMembersNamespace(transport)
        self.teams = _OrgsTeamsNamespace(transport)

    def create(self, *, name: str, display_name: str | None = None) -> Any:
        """Create a new organization."""
        body: dict[str, Any] = {"name": name}
        if display_name is not None:
            body["displayName"] = display_name
        return self._t._post("/api/v1/orgs", json=body)

    def list(self) -> Any:
        """List all organizations."""
        return self._t._get("/api/v1/orgs")

    def get(self, org_id: str) -> Any:
        """Get organization details."""
        return self._t._get(f"/api/v1/orgs/{org_id}")

    def delete(self, org_id: str) -> Any:
        """Delete an organization."""
        return self._t._delete(f"/api/v1/orgs/{org_id}")

    def update(
        self,
        org_id: str,
        *,
        display_name: str | None = None,
        settings: dict[str, Any] | None = None,
    ) -> Any:
        """Update an organization."""
        body: dict[str, Any] = {}
        if display_name is not None:
            body["displayName"] = display_name
        if settings is not None:
            body["settings"] = settings
        return self._t._patch(f"/api/v1/orgs/{org_id}", json=body)


class _MarketplaceTemplatesNamespace:
    """Marketplace template operations (nested under marketplace)."""

    def __init__(self, transport: SyncTransport) -> None:
        self._t = transport

    def list(
        self,
        *,
        category: str | None = None,
        tags: list[str] | None = None,
    ) -> Any:
        """List marketplace templates."""
        params: dict[str, Any] = {}
        if category is not None:
            params["category"] = category
        if tags is not None:
            params["tags"] = ",".join(tags)
        return self._t._get("/api/v1/marketplace/templates", params=params)

    def publish(self, template: Any) -> Any:
        """Publish a template to the marketplace."""
        return self._t._post("/api/v1/marketplace/templates", json=template)

    def unpublish(self, template_id: str) -> Any:
        """Unpublish (remove) a template from the marketplace."""
        return self._t._delete(f"/api/v1/marketplace/templates/{template_id}")

    def rate(self, template_id: str, *, rating: int, review: str | None = None) -> Any:
        """Rate a marketplace template."""
        body: dict[str, Any] = {"rating": rating}
        if review is not None:
            body["review"] = review
        return self._t._post(
            f"/api/v1/marketplace/templates/{template_id}/rate",
            json=body,
        )

    def fork(self, template_id: str) -> Any:
        """Fork a marketplace template into your workspace."""
        return self._t._post(f"/api/v1/marketplace/templates/{template_id}/fork")


class MarketplaceNamespace:
    """Marketplace endpoints."""

    def __init__(self, transport: SyncTransport) -> None:
        self._t = transport
        self.templates = _MarketplaceTemplatesNamespace(transport)


class IntegrationsNamespace:
    """Third-party integration endpoints."""

    def __init__(self, transport: SyncTransport) -> None:
        self._t = transport

    def list(self) -> Any:
        """List all integrations."""
        return self._t._get("/api/v1/integrations")

    def get(self, integration_id: str) -> Any:
        """Get integration details."""
        return self._t._get(f"/api/v1/integrations/{integration_id}")

    def register(
        self,
        *,
        type: str,
        name: str,
        credentials: dict[str, str] | None = None,
    ) -> Any:
        """Register a new integration."""
        body: dict[str, Any] = {"type": type, "name": name}
        if credentials is not None:
            body["credentials"] = credentials
        return self._t._post("/api/v1/integrations", json=body)

    def unregister(self, integration_id: str) -> Any:
        """Unregister (remove) an integration."""
        return self._t._delete(f"/api/v1/integrations/{integration_id}")

    def test(self, integration_id: str) -> Any:
        """Test an integration's connectivity."""
        return self._t._post(f"/api/v1/integrations/{integration_id}/test")

    def execute(
        self,
        integration_id: str,
        *,
        action: str,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Execute an action on an integration."""
        body: dict[str, Any] = {"action": action}
        if params is not None:
            body["params"] = params
        return self._t._post(
            f"/api/v1/integrations/{integration_id}/execute",
            json=body,
        )


class WebhooksNamespace:
    """Webhook endpoints."""

    def __init__(self, transport: SyncTransport) -> None:
        self._t = transport

    def list(self) -> Any:
        """List all webhooks."""
        return self._t._get("/api/v1/webhooks")

    def create(
        self,
        *,
        url: str,
        events: list[str],
        secret: str | None = None,
    ) -> Any:
        """Create a new webhook."""
        body: dict[str, Any] = {"url": url, "events": events}
        if secret is not None:
            body["secret"] = secret
        return self._t._post("/api/v1/webhooks", json=body)

    def delete(self, webhook_id: str) -> Any:
        """Delete a webhook."""
        return self._t._delete(f"/api/v1/webhooks/{webhook_id}")


class PluginsNamespace:
    """Plugin marketplace endpoints."""

    def __init__(self, transport: SyncTransport) -> None:
        self._t = transport

    def list(self, *, category: str | None = None) -> Any:
        """List available plugins."""
        params: dict[str, Any] = {}
        if category is not None:
            params["category"] = category
        return self._t._get("/api/v1/marketplace/plugins", params=params)

    def install(self, manifest: Any) -> Any:
        """Install a plugin from a manifest."""
        return self._t._post("/api/v1/marketplace/plugins", json=manifest)

    def uninstall(self, plugin_id: str) -> Any:
        """Uninstall a plugin."""
        return self._t._delete(f"/api/v1/marketplace/plugins/{plugin_id}")


# ---------------------------------------------------------------------------
# Async namespaces
# ---------------------------------------------------------------------------


class AsyncAgentsNamespace:
    """Agent lifecycle and interaction endpoints (async)."""

    def __init__(self, transport: AsyncTransport) -> None:
        self._t = transport

    async def list(
        self,
        *,
        status: str | None = None,
        limit: int | None = None,
        offset: int | None = None,
    ) -> Any:
        """List agents, optionally filtered by status."""
        params: dict[str, Any] = {}
        if status is not None:
            params["status"] = status
        if limit is not None:
            params["limit"] = limit
        if offset is not None:
            params["offset"] = offset
        return await self._t._get("/api/v1/agents", params=params)

    async def spawn(
        self,
        *,
        role: str,
        goal: str,
        model: str | None = None,
        tools: list[str] | None = None,
        max_steps: int | None = None,
    ) -> Any:
        """Spawn a new agent."""
        body: dict[str, Any] = {"role": role, "goal": goal}
        if model is not None:
            body["model"] = model
        if tools is not None:
            body["tools"] = tools
        if max_steps is not None:
            body["maxSteps"] = max_steps
        return await self._t._post("/api/v1/agents", json=body)

    async def get(self, uid: str) -> Any:
        """Get agent details by UID."""
        return await self._t._get(f"/api/v1/agents/{uid}")

    async def kill(self, uid: str) -> Any:
        """Kill (terminate) an agent."""
        return await self._t._delete(f"/api/v1/agents/{uid}")

    async def message(self, uid: str, content: str) -> Any:
        """Send a message to an agent."""
        return await self._t._post(
            f"/api/v1/agents/{uid}/message", json={"content": content}
        )

    async def timeline(
        self,
        uid: str,
        *,
        limit: int | None = None,
        offset: int | None = None,
    ) -> Any:
        """Retrieve an agent's event timeline."""
        params: dict[str, Any] = {}
        if limit is not None:
            params["limit"] = limit
        if offset is not None:
            params["offset"] = offset
        return await self._t._get(f"/api/v1/agents/{uid}/timeline", params=params)

    async def memory(
        self,
        uid: str,
        *,
        query: str | None = None,
        layer: str | None = None,
        limit: int | None = None,
    ) -> Any:
        """Query an agent's memory layers."""
        params: dict[str, Any] = {}
        if query is not None:
            params["query"] = query
        if layer is not None:
            params["layer"] = layer
        if limit is not None:
            params["limit"] = limit
        return await self._t._get(f"/api/v1/agents/{uid}/memory", params=params)

    async def plan(self, uid: str) -> Any:
        """Get an agent's current plan."""
        return await self._t._get(f"/api/v1/agents/{uid}/plan")

    async def profile(self, uid: str) -> Any:
        """Get an agent's profile."""
        return await self._t._get(f"/api/v1/agents/{uid}/profile")


class AsyncFSNamespace:
    """Virtual filesystem endpoints (async)."""

    def __init__(self, transport: AsyncTransport) -> None:
        self._t = transport

    async def read(self, path: str) -> Any:
        """Read a file from the virtual filesystem."""
        return await self._t._get(f"/api/v1/fs/{quote(path, safe='')}")

    async def write(self, path: str, content: str) -> Any:
        """Write content to a file in the virtual filesystem."""
        return await self._t._put(
            f"/api/v1/fs/{quote(path, safe='')}", json={"content": content}
        )

    async def delete(self, path: str) -> Any:
        """Delete a file from the virtual filesystem."""
        return await self._t._delete(f"/api/v1/fs/{quote(path, safe='')}")


class AsyncTemplatesNamespace:
    """Agent template endpoints (async)."""

    def __init__(self, transport: AsyncTransport) -> None:
        self._t = transport

    async def list(self) -> Any:
        """List all available templates."""
        return await self._t._get("/api/v1/templates")

    async def get(self, template_id: str) -> Any:
        """Get a template by ID."""
        return await self._t._get(f"/api/v1/templates/{template_id}")


class AsyncSystemNamespace:
    """System health and metrics endpoints (async)."""

    def __init__(self, transport: AsyncTransport) -> None:
        self._t = transport

    async def status(self) -> Any:
        """Get the system status."""
        return await self._t._get("/api/v1/system/status")

    async def metrics(self) -> Any:
        """Get system metrics."""
        return await self._t._get("/api/v1/system/metrics")


class AsyncCronNamespace:
    """Scheduled task (cron) endpoints (async)."""

    def __init__(self, transport: AsyncTransport) -> None:
        self._t = transport

    async def list(self) -> Any:
        """List all cron jobs."""
        return await self._t._get("/api/v1/cron")

    async def create(
        self,
        *,
        name: str,
        expression: str,
        agent_config: Any,
    ) -> Any:
        """Create a new cron job."""
        return await self._t._post(
            "/api/v1/cron",
            json={"name": name, "expression": expression, "agent_config": agent_config},
        )

    async def delete(self, cron_id: str) -> Any:
        """Delete a cron job."""
        return await self._t._delete(f"/api/v1/cron/{cron_id}")

    async def update(self, cron_id: str, *, enabled: bool | None = None) -> Any:
        """Update a cron job."""
        body: dict[str, Any] = {}
        if enabled is not None:
            body["enabled"] = enabled
        return await self._t._patch(f"/api/v1/cron/{cron_id}", json=body)


class AsyncTriggersNamespace:
    """Event trigger endpoints (async)."""

    def __init__(self, transport: AsyncTransport) -> None:
        self._t = transport

    async def list(self) -> Any:
        """List all triggers."""
        return await self._t._get("/api/v1/triggers")

    async def create(
        self,
        *,
        name: str,
        event_type: str,
        agent_config: Any,
    ) -> Any:
        """Create a new trigger."""
        return await self._t._post(
            "/api/v1/triggers",
            json={"name": name, "event_type": event_type, "agent_config": agent_config},
        )

    async def delete(self, trigger_id: str) -> Any:
        """Delete a trigger."""
        return await self._t._delete(f"/api/v1/triggers/{trigger_id}")


class _AsyncOrgsMembersNamespace:
    """Organization member management (nested under orgs, async)."""

    def __init__(self, transport: AsyncTransport) -> None:
        self._t = transport

    async def list(self, org_id: str) -> Any:
        """List members of an organization."""
        return await self._t._get(f"/api/v1/orgs/{org_id}/members")

    async def invite(self, org_id: str, *, user_id: str, role: str | None = None) -> Any:
        """Invite a user to an organization."""
        body: dict[str, Any] = {"userId": user_id}
        if role is not None:
            body["role"] = role
        return await self._t._post(f"/api/v1/orgs/{org_id}/members", json=body)

    async def remove(self, org_id: str, user_id: str) -> Any:
        """Remove a member from an organization."""
        return await self._t._delete(f"/api/v1/orgs/{org_id}/members/{user_id}")

    async def update_role(self, org_id: str, user_id: str, *, role: str) -> Any:
        """Update a member's role within an organization."""
        return await self._t._patch(
            f"/api/v1/orgs/{org_id}/members/{user_id}",
            json={"role": role},
        )


class _AsyncOrgsTeamsNamespace:
    """Organization team management (nested under orgs, async)."""

    def __init__(self, transport: AsyncTransport) -> None:
        self._t = transport

    async def list(self, org_id: str) -> Any:
        """List teams in an organization."""
        return await self._t._get(f"/api/v1/orgs/{org_id}/teams")

    async def create(
        self, org_id: str, *, name: str, description: str | None = None
    ) -> Any:
        """Create a team in an organization."""
        body: dict[str, Any] = {"name": name}
        if description is not None:
            body["description"] = description
        return await self._t._post(f"/api/v1/orgs/{org_id}/teams", json=body)

    async def delete(self, org_id: str, team_id: str) -> Any:
        """Delete a team."""
        return await self._t._delete(f"/api/v1/orgs/{org_id}/teams/{team_id}")

    async def add_member(
        self,
        org_id: str,
        team_id: str,
        *,
        user_id: str,
        role: str | None = None,
    ) -> Any:
        """Add a member to a team."""
        body: dict[str, Any] = {"userId": user_id}
        if role is not None:
            body["role"] = role
        return await self._t._post(
            f"/api/v1/orgs/{org_id}/teams/{team_id}/members",
            json=body,
        )

    async def remove_member(self, org_id: str, team_id: str, user_id: str) -> Any:
        """Remove a member from a team."""
        return await self._t._delete(
            f"/api/v1/orgs/{org_id}/teams/{team_id}/members/{user_id}"
        )


class AsyncOrgsNamespace:
    """Organization and RBAC endpoints (async)."""

    def __init__(self, transport: AsyncTransport) -> None:
        self._t = transport
        self.members = _AsyncOrgsMembersNamespace(transport)
        self.teams = _AsyncOrgsTeamsNamespace(transport)

    async def create(self, *, name: str, display_name: str | None = None) -> Any:
        """Create a new organization."""
        body: dict[str, Any] = {"name": name}
        if display_name is not None:
            body["displayName"] = display_name
        return await self._t._post("/api/v1/orgs", json=body)

    async def list(self) -> Any:
        """List all organizations."""
        return await self._t._get("/api/v1/orgs")

    async def get(self, org_id: str) -> Any:
        """Get organization details."""
        return await self._t._get(f"/api/v1/orgs/{org_id}")

    async def delete(self, org_id: str) -> Any:
        """Delete an organization."""
        return await self._t._delete(f"/api/v1/orgs/{org_id}")

    async def update(
        self,
        org_id: str,
        *,
        display_name: str | None = None,
        settings: dict[str, Any] | None = None,
    ) -> Any:
        """Update an organization."""
        body: dict[str, Any] = {}
        if display_name is not None:
            body["displayName"] = display_name
        if settings is not None:
            body["settings"] = settings
        return await self._t._patch(f"/api/v1/orgs/{org_id}", json=body)


class _AsyncMarketplaceTemplatesNamespace:
    """Marketplace template operations (nested under marketplace, async)."""

    def __init__(self, transport: AsyncTransport) -> None:
        self._t = transport

    async def list(
        self,
        *,
        category: str | None = None,
        tags: list[str] | None = None,
    ) -> Any:
        """List marketplace templates."""
        params: dict[str, Any] = {}
        if category is not None:
            params["category"] = category
        if tags is not None:
            params["tags"] = ",".join(tags)
        return await self._t._get("/api/v1/marketplace/templates", params=params)

    async def publish(self, template: Any) -> Any:
        """Publish a template to the marketplace."""
        return await self._t._post("/api/v1/marketplace/templates", json=template)

    async def unpublish(self, template_id: str) -> Any:
        """Unpublish (remove) a template from the marketplace."""
        return await self._t._delete(f"/api/v1/marketplace/templates/{template_id}")

    async def rate(
        self, template_id: str, *, rating: int, review: str | None = None
    ) -> Any:
        """Rate a marketplace template."""
        body: dict[str, Any] = {"rating": rating}
        if review is not None:
            body["review"] = review
        return await self._t._post(
            f"/api/v1/marketplace/templates/{template_id}/rate",
            json=body,
        )

    async def fork(self, template_id: str) -> Any:
        """Fork a marketplace template into your workspace."""
        return await self._t._post(
            f"/api/v1/marketplace/templates/{template_id}/fork"
        )


class AsyncMarketplaceNamespace:
    """Marketplace endpoints (async)."""

    def __init__(self, transport: AsyncTransport) -> None:
        self._t = transport
        self.templates = _AsyncMarketplaceTemplatesNamespace(transport)


class AsyncIntegrationsNamespace:
    """Third-party integration endpoints (async)."""

    def __init__(self, transport: AsyncTransport) -> None:
        self._t = transport

    async def list(self) -> Any:
        """List all integrations."""
        return await self._t._get("/api/v1/integrations")

    async def get(self, integration_id: str) -> Any:
        """Get integration details."""
        return await self._t._get(f"/api/v1/integrations/{integration_id}")

    async def register(
        self,
        *,
        type: str,
        name: str,
        credentials: dict[str, str] | None = None,
    ) -> Any:
        """Register a new integration."""
        body: dict[str, Any] = {"type": type, "name": name}
        if credentials is not None:
            body["credentials"] = credentials
        return await self._t._post("/api/v1/integrations", json=body)

    async def unregister(self, integration_id: str) -> Any:
        """Unregister (remove) an integration."""
        return await self._t._delete(f"/api/v1/integrations/{integration_id}")

    async def test(self, integration_id: str) -> Any:
        """Test an integration's connectivity."""
        return await self._t._post(f"/api/v1/integrations/{integration_id}/test")

    async def execute(
        self,
        integration_id: str,
        *,
        action: str,
        params: dict[str, Any] | None = None,
    ) -> Any:
        """Execute an action on an integration."""
        body: dict[str, Any] = {"action": action}
        if params is not None:
            body["params"] = params
        return await self._t._post(
            f"/api/v1/integrations/{integration_id}/execute",
            json=body,
        )


class AsyncWebhooksNamespace:
    """Webhook endpoints (async)."""

    def __init__(self, transport: AsyncTransport) -> None:
        self._t = transport

    async def list(self) -> Any:
        """List all webhooks."""
        return await self._t._get("/api/v1/webhooks")

    async def create(
        self,
        *,
        url: str,
        events: list[str],
        secret: str | None = None,
    ) -> Any:
        """Create a new webhook."""
        body: dict[str, Any] = {"url": url, "events": events}
        if secret is not None:
            body["secret"] = secret
        return await self._t._post("/api/v1/webhooks", json=body)

    async def delete(self, webhook_id: str) -> Any:
        """Delete a webhook."""
        return await self._t._delete(f"/api/v1/webhooks/{webhook_id}")


class AsyncPluginsNamespace:
    """Plugin marketplace endpoints (async)."""

    def __init__(self, transport: AsyncTransport) -> None:
        self._t = transport

    async def list(self, *, category: str | None = None) -> Any:
        """List available plugins."""
        params: dict[str, Any] = {}
        if category is not None:
            params["category"] = category
        return await self._t._get("/api/v1/marketplace/plugins", params=params)

    async def install(self, manifest: Any) -> Any:
        """Install a plugin from a manifest."""
        return await self._t._post("/api/v1/marketplace/plugins", json=manifest)

    async def uninstall(self, plugin_id: str) -> Any:
        """Uninstall a plugin."""
        return await self._t._delete(f"/api/v1/marketplace/plugins/{plugin_id}")
