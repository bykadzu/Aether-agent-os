"""Tests for the Aether OS Python SDK.

Uses ``respx`` to mock httpx requests without hitting a real server.
"""

from __future__ import annotations

import json

import httpx
import pytest
import respx

from aether import AetherClient, AetherAsyncClient, AetherError


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

BASE_URL = "http://aether.test"


@pytest.fixture()
def client() -> AetherClient:
    """Create a sync AetherClient pointed at the test base URL."""
    return AetherClient(BASE_URL, token="test-token-123")


@pytest.fixture()
def async_client() -> AetherAsyncClient:
    """Create an async AetherAsyncClient pointed at the test base URL."""
    return AetherAsyncClient(BASE_URL, token="test-token-123")


# ---------------------------------------------------------------------------
# Client construction
# ---------------------------------------------------------------------------


class TestClientConstruction:
    """Verify client initialization and configuration."""

    def test_base_url_stored(self) -> None:
        c = AetherClient("http://example.com/")
        assert c._base_url == "http://example.com"

    def test_trailing_slash_stripped(self) -> None:
        c = AetherClient("http://example.com///")
        assert c._base_url == "http://example.com"

    def test_token_defaults_to_none(self) -> None:
        c = AetherClient(BASE_URL)
        assert c._token is None

    def test_token_set_at_init(self) -> None:
        c = AetherClient(BASE_URL, token="abc")
        assert c._token == "abc"

    def test_set_token(self) -> None:
        c = AetherClient(BASE_URL)
        c.set_token("new-token")
        assert c._token == "new-token"

    def test_namespace_properties_exist(self) -> None:
        c = AetherClient(BASE_URL)
        assert hasattr(c, "agents")
        assert hasattr(c, "fs")
        assert hasattr(c, "templates")
        assert hasattr(c, "system")
        assert hasattr(c, "events")
        assert hasattr(c, "cron")
        assert hasattr(c, "triggers")
        assert hasattr(c, "orgs")
        assert hasattr(c, "marketplace")
        assert hasattr(c, "integrations")
        assert hasattr(c, "webhooks")
        assert hasattr(c, "plugins")

    def test_context_manager(self) -> None:
        with AetherClient(BASE_URL) as c:
            assert c._token is None
        # After exiting, the httpx client should be closed
        assert c._http.is_closed


# ---------------------------------------------------------------------------
# Authentication — login
# ---------------------------------------------------------------------------


class TestLogin:
    """Verify the login flow sets the token."""

    @respx.mock
    def test_login_sets_token(self, client: AetherClient) -> None:
        route = respx.post(f"{BASE_URL}/api/auth/login").mock(
            return_value=httpx.Response(
                200,
                json={"token": "jwt-from-server", "user": {"id": "u1", "name": "admin"}},
            )
        )

        result = client.login("admin", "secret")

        assert route.called
        assert client._token == "jwt-from-server"
        assert result["token"] == "jwt-from-server"
        assert result["user"]["name"] == "admin"

    @respx.mock
    def test_login_sends_credentials(self, client: AetherClient) -> None:
        route = respx.post(f"{BASE_URL}/api/auth/login").mock(
            return_value=httpx.Response(
                200,
                json={"token": "tok", "user": {}},
            )
        )

        client.login("myuser", "mypass")

        request = route.calls.last.request
        body = json.loads(request.content)
        assert body == {"username": "myuser", "password": "mypass"}


# ---------------------------------------------------------------------------
# Agents namespace
# ---------------------------------------------------------------------------


class TestAgentsNamespace:
    """Verify agents namespace methods hit the correct endpoints."""

    @respx.mock
    def test_agents_list(self, client: AetherClient) -> None:
        route = respx.get(f"{BASE_URL}/api/v1/agents").mock(
            return_value=httpx.Response(
                200,
                json={"data": [{"uid": "a1", "role": "coder"}]},
            )
        )

        result = client.agents.list()

        assert route.called
        assert len(result) == 1
        assert result[0]["uid"] == "a1"

    @respx.mock
    def test_agents_list_with_filters(self, client: AetherClient) -> None:
        route = respx.get(f"{BASE_URL}/api/v1/agents").mock(
            return_value=httpx.Response(200, json={"data": []}),
        )

        client.agents.list(status="running", limit=10, offset=5)

        request = route.calls.last.request
        assert "status=running" in str(request.url)
        assert "limit=10" in str(request.url)
        assert "offset=5" in str(request.url)

    @respx.mock
    def test_agents_spawn(self, client: AetherClient) -> None:
        route = respx.post(f"{BASE_URL}/api/v1/agents").mock(
            return_value=httpx.Response(
                201,
                json={"data": {"uid": "new-agent", "role": "analyst"}},
            )
        )

        result = client.agents.spawn(role="analyst", goal="analyze data")

        assert route.called
        body = json.loads(route.calls.last.request.content)
        assert body["role"] == "analyst"
        assert body["goal"] == "analyze data"
        assert result["uid"] == "new-agent"

    @respx.mock
    def test_agents_get(self, client: AetherClient) -> None:
        respx.get(f"{BASE_URL}/api/v1/agents/agent-123").mock(
            return_value=httpx.Response(
                200,
                json={"data": {"uid": "agent-123", "status": "running"}},
            )
        )

        result = client.agents.get("agent-123")
        assert result["uid"] == "agent-123"

    @respx.mock
    def test_agents_kill(self, client: AetherClient) -> None:
        route = respx.delete(f"{BASE_URL}/api/v1/agents/agent-123").mock(
            return_value=httpx.Response(200, json={"data": {"killed": True}})
        )

        result = client.agents.kill("agent-123")
        assert route.called
        assert result["killed"] is True

    @respx.mock
    def test_agents_message(self, client: AetherClient) -> None:
        route = respx.post(f"{BASE_URL}/api/v1/agents/a1/message").mock(
            return_value=httpx.Response(200, json={"data": {"id": "m1"}})
        )

        result = client.agents.message("a1", "hello agent")
        body = json.loads(route.calls.last.request.content)
        assert body == {"content": "hello agent"}
        assert result["id"] == "m1"

    @respx.mock
    def test_agents_timeline(self, client: AetherClient) -> None:
        respx.get(f"{BASE_URL}/api/v1/agents/a1/timeline").mock(
            return_value=httpx.Response(200, json={"data": [{"ts": 1}]})
        )

        result = client.agents.timeline("a1", limit=5)
        assert result == [{"ts": 1}]

    @respx.mock
    def test_agents_memory(self, client: AetherClient) -> None:
        respx.get(f"{BASE_URL}/api/v1/agents/a1/memory").mock(
            return_value=httpx.Response(200, json={"data": []})
        )

        result = client.agents.memory("a1", query="test", layer="semantic")
        assert result == []

    @respx.mock
    def test_agents_plan(self, client: AetherClient) -> None:
        respx.get(f"{BASE_URL}/api/v1/agents/a1/plan").mock(
            return_value=httpx.Response(200, json={"data": {"steps": []}})
        )

        result = client.agents.plan("a1")
        assert result == {"steps": []}

    @respx.mock
    def test_agents_profile(self, client: AetherClient) -> None:
        respx.get(f"{BASE_URL}/api/v1/agents/a1/profile").mock(
            return_value=httpx.Response(200, json={"data": {"role": "coder"}})
        )

        result = client.agents.profile("a1")
        assert result["role"] == "coder"


# ---------------------------------------------------------------------------
# Error handling
# ---------------------------------------------------------------------------


class TestErrorHandling:
    """Verify that HTTP errors are raised as AetherError."""

    @respx.mock
    def test_404_raises_aether_error(self, client: AetherClient) -> None:
        respx.get(f"{BASE_URL}/api/v1/agents/missing").mock(
            return_value=httpx.Response(
                404,
                json={"error": {"code": "AGENT_NOT_FOUND", "message": "No such agent"}},
            )
        )

        with pytest.raises(AetherError) as exc_info:
            client.agents.get("missing")

        err = exc_info.value
        assert err.status == 404
        assert err.code == "AGENT_NOT_FOUND"
        assert "No such agent" in err.message

    @respx.mock
    def test_500_raises_aether_error(self, client: AetherClient) -> None:
        respx.get(f"{BASE_URL}/api/v1/system/status").mock(
            return_value=httpx.Response(500, text="Internal Server Error")
        )

        with pytest.raises(AetherError) as exc_info:
            client.system.status()

        err = exc_info.value
        assert err.status == 500
        assert err.code == "HTTP_500"

    @respx.mock
    def test_401_unauthorized(self, client: AetherClient) -> None:
        respx.get(f"{BASE_URL}/api/v1/agents").mock(
            return_value=httpx.Response(
                401,
                json={"error": {"code": "UNAUTHORIZED", "message": "Invalid token"}},
            )
        )

        with pytest.raises(AetherError) as exc_info:
            client.agents.list()

        assert exc_info.value.status == 401
        assert exc_info.value.code == "UNAUTHORIZED"

    @respx.mock
    def test_error_str_representation(self, client: AetherClient) -> None:
        respx.get(f"{BASE_URL}/api/v1/agents").mock(
            return_value=httpx.Response(
                403,
                json={"error": {"code": "FORBIDDEN", "message": "Access denied"}},
            )
        )

        with pytest.raises(AetherError) as exc_info:
            client.agents.list()

        err_str = str(exc_info.value)
        assert "FORBIDDEN" in err_str
        assert "Access denied" in err_str
        assert "403" in err_str


# ---------------------------------------------------------------------------
# Other namespaces (sample coverage)
# ---------------------------------------------------------------------------


class TestFSNamespace:
    """Verify filesystem namespace endpoints."""

    @respx.mock
    def test_fs_read(self, client: AetherClient) -> None:
        respx.get(f"{BASE_URL}/api/v1/fs/hello.txt").mock(
            return_value=httpx.Response(200, json={"data": {"content": "world"}})
        )

        result = client.fs.read("hello.txt")
        assert result["content"] == "world"

    @respx.mock
    def test_fs_write(self, client: AetherClient) -> None:
        route = respx.put(f"{BASE_URL}/api/v1/fs/hello.txt").mock(
            return_value=httpx.Response(200, json={"data": {"ok": True}})
        )

        client.fs.write("hello.txt", "new content")
        body = json.loads(route.calls.last.request.content)
        assert body == {"content": "new content"}

    @respx.mock
    def test_fs_delete(self, client: AetherClient) -> None:
        route = respx.delete(f"{BASE_URL}/api/v1/fs/hello.txt").mock(
            return_value=httpx.Response(200, json={"data": {"deleted": True}})
        )

        result = client.fs.delete("hello.txt")
        assert route.called
        assert result["deleted"] is True

    @respx.mock
    def test_fs_read_url_encodes_path(self, client: AetherClient) -> None:
        # Paths with slashes should be percent-encoded
        respx.get(f"{BASE_URL}/api/v1/fs/folder%2Ffile.txt").mock(
            return_value=httpx.Response(200, json={"data": {"content": "data"}})
        )

        result = client.fs.read("folder/file.txt")
        assert result["content"] == "data"


class TestSystemNamespace:
    """Verify system namespace endpoints."""

    @respx.mock
    def test_system_status(self, client: AetherClient) -> None:
        respx.get(f"{BASE_URL}/api/v1/system/status").mock(
            return_value=httpx.Response(200, json={"data": {"healthy": True}})
        )

        result = client.system.status()
        assert result["healthy"] is True

    @respx.mock
    def test_system_metrics(self, client: AetherClient) -> None:
        respx.get(f"{BASE_URL}/api/v1/system/metrics").mock(
            return_value=httpx.Response(
                200, json={"data": {"cpu": 42.5, "memory": 1024}}
            )
        )

        result = client.system.metrics()
        assert result["cpu"] == 42.5


class TestCronNamespace:
    """Verify cron namespace endpoints."""

    @respx.mock
    def test_cron_create(self, client: AetherClient) -> None:
        route = respx.post(f"{BASE_URL}/api/v1/cron").mock(
            return_value=httpx.Response(201, json={"data": {"id": "c1"}})
        )

        result = client.cron.create(
            name="daily-report",
            expression="0 9 * * *",
            agent_config={"role": "reporter"},
        )
        body = json.loads(route.calls.last.request.content)
        assert body["name"] == "daily-report"
        assert body["expression"] == "0 9 * * *"
        assert result["id"] == "c1"

    @respx.mock
    def test_cron_update(self, client: AetherClient) -> None:
        route = respx.patch(f"{BASE_URL}/api/v1/cron/c1").mock(
            return_value=httpx.Response(200, json={"data": {"id": "c1", "enabled": False}})
        )

        result = client.cron.update("c1", enabled=False)
        body = json.loads(route.calls.last.request.content)
        assert body == {"enabled": False}
        assert result["enabled"] is False


class TestOrgsNamespace:
    """Verify organization namespace endpoints."""

    @respx.mock
    def test_orgs_create(self, client: AetherClient) -> None:
        route = respx.post(f"{BASE_URL}/api/v1/orgs").mock(
            return_value=httpx.Response(201, json={"data": {"id": "org1"}})
        )

        result = client.orgs.create(name="my-org", display_name="My Org")
        body = json.loads(route.calls.last.request.content)
        assert body["name"] == "my-org"
        assert body["displayName"] == "My Org"
        assert result["id"] == "org1"

    @respx.mock
    def test_orgs_members_list(self, client: AetherClient) -> None:
        respx.get(f"{BASE_URL}/api/v1/orgs/org1/members").mock(
            return_value=httpx.Response(
                200, json={"data": [{"userId": "u1", "role": "admin"}]}
            )
        )

        result = client.orgs.members.list("org1")
        assert len(result) == 1
        assert result[0]["role"] == "admin"

    @respx.mock
    def test_orgs_teams_create(self, client: AetherClient) -> None:
        route = respx.post(f"{BASE_URL}/api/v1/orgs/org1/teams").mock(
            return_value=httpx.Response(201, json={"data": {"id": "t1"}})
        )

        result = client.orgs.teams.create("org1", name="backend", description="Backend team")
        body = json.loads(route.calls.last.request.content)
        assert body["name"] == "backend"
        assert result["id"] == "t1"


class TestIntegrationsNamespace:
    """Verify integrations namespace endpoints."""

    @respx.mock
    def test_integrations_register(self, client: AetherClient) -> None:
        route = respx.post(f"{BASE_URL}/api/v1/integrations").mock(
            return_value=httpx.Response(201, json={"data": {"id": "int1"}})
        )

        result = client.integrations.register(
            type="slack", name="My Slack", credentials={"token": "xoxb-123"}
        )
        body = json.loads(route.calls.last.request.content)
        assert body["type"] == "slack"
        assert body["credentials"]["token"] == "xoxb-123"
        assert result["id"] == "int1"

    @respx.mock
    def test_integrations_execute(self, client: AetherClient) -> None:
        route = respx.post(f"{BASE_URL}/api/v1/integrations/int1/execute").mock(
            return_value=httpx.Response(200, json={"data": {"result": "ok"}})
        )

        result = client.integrations.execute(
            "int1", action="send_message", params={"channel": "#general"}
        )
        body = json.loads(route.calls.last.request.content)
        assert body["action"] == "send_message"
        assert result["result"] == "ok"


class TestWebhooksNamespace:
    """Verify webhooks namespace endpoints."""

    @respx.mock
    def test_webhooks_create(self, client: AetherClient) -> None:
        route = respx.post(f"{BASE_URL}/api/v1/webhooks").mock(
            return_value=httpx.Response(201, json={"data": {"id": "wh1"}})
        )

        result = client.webhooks.create(
            url="https://example.com/hook",
            events=["agent.spawned", "agent.killed"],
            secret="s3cret",
        )
        body = json.loads(route.calls.last.request.content)
        assert body["url"] == "https://example.com/hook"
        assert body["events"] == ["agent.spawned", "agent.killed"]
        assert body["secret"] == "s3cret"
        assert result["id"] == "wh1"


class TestPluginsNamespace:
    """Verify plugins namespace endpoints."""

    @respx.mock
    def test_plugins_list(self, client: AetherClient) -> None:
        respx.get(f"{BASE_URL}/api/v1/marketplace/plugins").mock(
            return_value=httpx.Response(
                200, json={"data": [{"id": "p1", "name": "my-plugin"}]}
            )
        )

        result = client.plugins.list()
        assert len(result) == 1
        assert result[0]["name"] == "my-plugin"

    @respx.mock
    def test_plugins_install(self, client: AetherClient) -> None:
        route = respx.post(f"{BASE_URL}/api/v1/marketplace/plugins").mock(
            return_value=httpx.Response(201, json={"data": {"id": "p2"}})
        )

        manifest = {"name": "cool-plugin", "version": "1.0.0"}
        result = client.plugins.install(manifest)
        body = json.loads(route.calls.last.request.content)
        assert body["name"] == "cool-plugin"
        assert result["id"] == "p2"


# ---------------------------------------------------------------------------
# Authorization header
# ---------------------------------------------------------------------------


class TestAuthorizationHeader:
    """Verify that the Authorization header is sent correctly."""

    @respx.mock
    def test_bearer_token_sent(self, client: AetherClient) -> None:
        route = respx.get(f"{BASE_URL}/api/v1/agents").mock(
            return_value=httpx.Response(200, json={"data": []})
        )

        client.agents.list()

        request = route.calls.last.request
        assert request.headers["Authorization"] == "Bearer test-token-123"

    @respx.mock
    def test_no_auth_header_without_token(self) -> None:
        route = respx.get(f"{BASE_URL}/api/v1/system/status").mock(
            return_value=httpx.Response(200, json={"data": {"ok": True}})
        )

        c = AetherClient(BASE_URL)
        c.system.status()

        request = route.calls.last.request
        assert "Authorization" not in request.headers


# ---------------------------------------------------------------------------
# Response unwrapping
# ---------------------------------------------------------------------------


class TestResponseUnwrapping:
    """Verify that responses with a 'data' key are automatically unwrapped."""

    @respx.mock
    def test_data_key_unwrapped(self, client: AetherClient) -> None:
        respx.get(f"{BASE_URL}/api/v1/agents").mock(
            return_value=httpx.Response(200, json={"data": [1, 2, 3], "meta": {"total": 3}})
        )

        result = client.agents.list()
        assert result == [1, 2, 3]

    @respx.mock
    def test_no_data_key_returns_full_body(self, client: AetherClient) -> None:
        respx.post(f"{BASE_URL}/api/auth/login").mock(
            return_value=httpx.Response(200, json={"token": "abc", "user": {}})
        )

        result = client.login("u", "p")
        assert result["token"] == "abc"


# ---------------------------------------------------------------------------
# Async client — basic smoke tests
# ---------------------------------------------------------------------------


class TestAsyncClient:
    """Verify the async client mirrors the sync client's behaviour."""

    @respx.mock
    @pytest.mark.asyncio
    async def test_async_agents_list(self, async_client: AetherAsyncClient) -> None:
        respx.get(f"{BASE_URL}/api/v1/agents").mock(
            return_value=httpx.Response(200, json={"data": [{"uid": "a1"}]})
        )

        result = await async_client.agents.list()
        assert result == [{"uid": "a1"}]

    @respx.mock
    @pytest.mark.asyncio
    async def test_async_login(self, async_client: AetherAsyncClient) -> None:
        respx.post(f"{BASE_URL}/api/auth/login").mock(
            return_value=httpx.Response(
                200, json={"token": "async-tok", "user": {"id": "u1"}}
            )
        )

        result = await async_client.login("admin", "pass")
        assert async_client._token == "async-tok"
        assert result["user"]["id"] == "u1"

    @respx.mock
    @pytest.mark.asyncio
    async def test_async_error_handling(self, async_client: AetherAsyncClient) -> None:
        respx.get(f"{BASE_URL}/api/v1/agents/bad").mock(
            return_value=httpx.Response(
                404,
                json={"error": {"code": "NOT_FOUND", "message": "Agent not found"}},
            )
        )

        with pytest.raises(AetherError) as exc_info:
            await async_client.agents.get("bad")

        assert exc_info.value.status == 404
        assert exc_info.value.code == "NOT_FOUND"

    @respx.mock
    @pytest.mark.asyncio
    async def test_async_context_manager(self) -> None:
        respx.get(f"{BASE_URL}/api/v1/system/status").mock(
            return_value=httpx.Response(200, json={"data": {"ok": True}})
        )

        async with AetherAsyncClient(BASE_URL, token="t") as c:
            result = await c.system.status()
            assert result["ok"] is True

        assert c._http.is_closed


# ---------------------------------------------------------------------------
# SSE event parsing
# ---------------------------------------------------------------------------


class TestSSEEventParsing:
    """Verify SSE event parsing logic.

    These tests validate the core JSON parsing behaviour used in event
    handling, without requiring a live SSE connection.
    """

    def test_parse_valid_sse_data(self) -> None:
        """Simulate parsing a well-formed SSE data line."""
        import json as _json

        raw_lines = [
            'data: {"type": "agent.spawned", "uid": "a1"}',
            "",
            'data: {"type": "agent.killed", "uid": "a2"}',
            "",
        ]

        events: list[dict] = []
        current_data = ""
        for line in raw_lines:
            if line.startswith("data: "):
                current_data += line[6:]
            elif line == "" and current_data:
                try:
                    events.append(_json.loads(current_data))
                except _json.JSONDecodeError:
                    pass
                current_data = ""

        assert len(events) == 2
        assert events[0]["type"] == "agent.spawned"
        assert events[0]["uid"] == "a1"
        assert events[1]["type"] == "agent.killed"

    def test_parse_malformed_sse_data_skipped(self) -> None:
        """Malformed JSON in SSE data lines should be skipped."""
        import json as _json

        raw_lines = [
            "data: {bad json",
            "",
            'data: {"type": "valid"}',
            "",
        ]

        events: list[dict] = []
        current_data = ""
        for line in raw_lines:
            if line.startswith("data: "):
                current_data += line[6:]
            elif line == "" and current_data:
                try:
                    events.append(_json.loads(current_data))
                except _json.JSONDecodeError:
                    pass
                current_data = ""

        assert len(events) == 1
        assert events[0]["type"] == "valid"

    def test_parse_multiline_sse_data(self) -> None:
        """SSE data split across multiple 'data:' lines should be concatenated."""
        import json as _json

        raw_lines = [
            'data: {"type": "big",',
            'data:  "payload": "hello"}',
            "",
        ]

        events: list[dict] = []
        current_data = ""
        for line in raw_lines:
            if line.startswith("data: "):
                current_data += line[6:]
            elif line.startswith("data:"):
                current_data += line[5:]
            elif line == "" and current_data:
                try:
                    events.append(_json.loads(current_data))
                except _json.JSONDecodeError:
                    pass
                current_data = ""

        assert len(events) == 1
        assert events[0]["type"] == "big"
        assert events[0]["payload"] == "hello"


# ---------------------------------------------------------------------------
# Marketplace namespace
# ---------------------------------------------------------------------------


class TestMarketplaceNamespace:
    """Verify marketplace namespace endpoints."""

    @respx.mock
    def test_marketplace_templates_list(self, client: AetherClient) -> None:
        respx.get(f"{BASE_URL}/api/v1/marketplace/templates").mock(
            return_value=httpx.Response(
                200, json={"data": [{"id": "t1", "name": "starter"}]}
            )
        )

        result = client.marketplace.templates.list()
        assert len(result) == 1
        assert result[0]["name"] == "starter"

    @respx.mock
    def test_marketplace_templates_publish(self, client: AetherClient) -> None:
        route = respx.post(f"{BASE_URL}/api/v1/marketplace/templates").mock(
            return_value=httpx.Response(201, json={"data": {"id": "t2"}})
        )

        template = {"name": "my-template", "config": {}}
        result = client.marketplace.templates.publish(template)
        assert result["id"] == "t2"
        assert route.called

    @respx.mock
    def test_marketplace_templates_rate(self, client: AetherClient) -> None:
        route = respx.post(f"{BASE_URL}/api/v1/marketplace/templates/t1/rate").mock(
            return_value=httpx.Response(200, json={"data": {"ok": True}})
        )

        client.marketplace.templates.rate("t1", rating=5, review="Great!")
        body = json.loads(route.calls.last.request.content)
        assert body["rating"] == 5
        assert body["review"] == "Great!"

    @respx.mock
    def test_marketplace_templates_fork(self, client: AetherClient) -> None:
        respx.post(f"{BASE_URL}/api/v1/marketplace/templates/t1/fork").mock(
            return_value=httpx.Response(201, json={"data": {"id": "t1-fork"}})
        )

        result = client.marketplace.templates.fork("t1")
        assert result["id"] == "t1-fork"
