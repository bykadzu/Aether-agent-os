# aether-os-sdk

Python SDK for [Aether OS](https://github.com/aether-os/aether-agent-os) -- manage agents, filesystems, and workflows programmatically.

## Installation

```bash
pip install aether-os-sdk
```

## Quick start

### Synchronous

```python
from aether import AetherClient

client = AetherClient("http://localhost:3000")
client.login("admin", "password")

# List running agents
agents = client.agents.list(status="running")

# Spawn a new agent
agent = client.agents.spawn(role="analyst", goal="Summarize sales data")

# Read from the virtual filesystem
content = client.fs.read("reports/summary.md")

# Check system health
status = client.system.status()
```

### Asynchronous

```python
import asyncio
from aether import AetherAsyncClient

async def main():
    async with AetherAsyncClient("http://localhost:3000", token="my-token") as client:
        agents = await client.agents.list()
        metrics = await client.system.metrics()
        print(agents, metrics)

asyncio.run(main())
```

### Server-Sent Events

```python
from aether import AetherClient

client = AetherClient("http://localhost:3000", token="my-token")

for event in client.events.subscribe(filter=["agent.spawned", "agent.killed"]):
    print(event["type"], event)
```

## API namespaces

| Namespace | Description |
|---|---|
| `client.agents` | Spawn, list, message, kill agents; query timeline, memory, plan, profile |
| `client.fs` | Read, write, delete files in the virtual filesystem |
| `client.templates` | List and retrieve agent templates |
| `client.system` | System status and metrics |
| `client.events` | Subscribe to real-time SSE events |
| `client.cron` | Create, list, update, delete scheduled jobs |
| `client.triggers` | Create, list, delete event triggers |
| `client.orgs` | Organization CRUD, plus `.members` and `.teams` sub-namespaces |
| `client.marketplace` | `.templates` sub-namespace for publish, rate, fork |
| `client.integrations` | Register, test, execute third-party integrations |
| `client.webhooks` | Create, list, delete webhooks |
| `client.plugins` | Install, list, uninstall plugins |

## Error handling

All API errors raise `AetherError` with `code`, `status`, and `message` attributes:

```python
from aether import AetherClient, AetherError

client = AetherClient("http://localhost:3000", token="my-token")

try:
    client.agents.get("nonexistent-uid")
except AetherError as e:
    print(e.code)     # "AGENT_NOT_FOUND"
    print(e.status)   # 404
    print(e.message)  # "No such agent"
```

## Development

```bash
pip install -e ".[dev]"
pytest
```

## License

MIT
