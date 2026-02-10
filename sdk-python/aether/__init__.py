"""Aether OS Python SDK.

Provides synchronous and asynchronous clients for the Aether OS REST API.

Quick start::

    from aether import AetherClient

    client = AetherClient("http://localhost:3000", token="my-token")
    agents = client.agents.list()
    print(agents)

For async usage::

    from aether import AetherAsyncClient

    async def main():
        async with AetherAsyncClient("http://localhost:3000") as client:
            await client.login("admin", "password")
            agents = await client.agents.list()
"""

from __future__ import annotations

from aether.client import AetherClient
from aether.async_client import AetherAsyncClient
from aether.exceptions import AetherError

__all__ = [
    "AetherClient",
    "AetherAsyncClient",
    "AetherError",
]

__version__ = "0.4.0"
