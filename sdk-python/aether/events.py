"""Server-Sent Events (SSE) support for the Aether OS SDK.

Provides both synchronous and asynchronous generators for consuming
real-time events from the Aether OS event stream.
"""

from __future__ import annotations

import json
from typing import Any, AsyncIterator, Iterator

import httpx
from httpx_sse import connect_sse, aconnect_sse


def subscribe_events(
    base_url: str,
    token: str | None = None,
    filter: list[str] | None = None,
    *,
    timeout: float = 0,
) -> Iterator[dict[str, Any]]:
    """Subscribe to Aether OS events via Server-Sent Events (synchronous).

    Yields parsed JSON event objects from the SSE stream. The connection
    remains open until the server closes it or the generator is closed by
    the caller.

    Args:
        base_url: The Aether OS base URL (e.g. ``"http://localhost:3000"``).
        token: Optional bearer token for authentication.
        filter: Optional list of event type strings to subscribe to.
        timeout: HTTP timeout in seconds. ``0`` means no timeout (wait
            indefinitely for events).

    Yields:
        Parsed event dictionaries.

    Raises:
        httpx.HTTPStatusError: If the server returns a non-2xx status.

    Example::

        for event in subscribe_events("http://localhost:3000", token="..."):
            print(event["type"], event)
    """
    url = base_url.rstrip("/") + "/api/v1/events"
    params: dict[str, str] = {}
    if filter:
        params["filter"] = ",".join(filter)

    headers: dict[str, str] = {"Accept": "text/event-stream"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    with httpx.Client(timeout=timeout if timeout > 0 else None) as client:
        with connect_sse(
            client, "GET", url, params=params, headers=headers
        ) as event_source:
            event_source.response.raise_for_status()
            for sse in event_source.iter_sse():
                if sse.data:
                    try:
                        yield json.loads(sse.data)
                    except json.JSONDecodeError:
                        # Skip malformed events, matching the TS SDK behaviour
                        continue


async def subscribe_events_async(
    base_url: str,
    token: str | None = None,
    filter: list[str] | None = None,
    *,
    timeout: float = 0,
) -> AsyncIterator[dict[str, Any]]:
    """Subscribe to Aether OS events via Server-Sent Events (asynchronous).

    Yields parsed JSON event objects from the SSE stream. The connection
    remains open until the server closes it or the async generator is closed
    by the caller.

    Args:
        base_url: The Aether OS base URL (e.g. ``"http://localhost:3000"``).
        token: Optional bearer token for authentication.
        filter: Optional list of event type strings to subscribe to.
        timeout: HTTP timeout in seconds. ``0`` means no timeout.

    Yields:
        Parsed event dictionaries.

    Raises:
        httpx.HTTPStatusError: If the server returns a non-2xx status.

    Example::

        async for event in subscribe_events_async("http://localhost:3000"):
            print(event["type"], event)
    """
    url = base_url.rstrip("/") + "/api/v1/events"
    params: dict[str, str] = {}
    if filter:
        params["filter"] = ",".join(filter)

    headers: dict[str, str] = {"Accept": "text/event-stream"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    async with httpx.AsyncClient(timeout=timeout if timeout > 0 else None) as client:
        async with aconnect_sse(
            client, "GET", url, params=params, headers=headers
        ) as event_source:
            event_source.response.raise_for_status()
            async for sse in event_source.aiter_sse():
                if sse.data:
                    try:
                        yield json.loads(sse.data)
                    except json.JSONDecodeError:
                        continue
