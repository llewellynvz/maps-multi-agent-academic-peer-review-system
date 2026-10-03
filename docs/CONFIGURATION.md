# Configuration reference

MAPS is configured entirely through environment variables. In a container deployment they are read from `.env` (or the file named by `MAPS_ENV_FILE`); a native worker reads the same file from the repository root. [`.env.example`](../.env.example) is the annotated template.

Variables use the `MAPS_` prefix. Deployments configured before the rename may keep their `MARA_` names: each legacy `MARA_` variable is read as its `MAPS_` equivalent whenever the `MAPS_` name is unset, and an explicit `MAPS_` value always wins. Docker Compose applies the same fallback to `MAPS_BIND`, `MAPS_PORT`, and `MAPS_ENV_FILE`.

Blank values are treated as unset. An empty `OPENAI_API_KEY=` line from a copied template never shadows a key stored through the application.

## 1. Model providers and routing

The engine dispatches to three roles:

| Role | Used for |
|---|---|
| `frontier` | Specialist lenses, synthesis, the report writer, and the release-gate critic |
| `cheap` | Sanitisation screening, lite parsing, and supporting agents |
| `local` | Agents whose manifest routes them to a local model |

### Azure OpenAI (default)

| Variable | Required | Purpose |
|---|---|---|
| `AZURE_OPENAI_ENDPOINT` | Yes | Azure OpenAI resource endpoint |
| `AZURE_OPENAI_API_VERSION` | Yes | API version for the chat deployments |
| `AZURE_TENANT_ID` | Yes | Entra ID tenant |
| `AZURE_CLIENT_ID` | Yes | Application (client) ID |
| `AZURE_CLIENT_CERT_PEM_PATH` | Yes | Path to the client certificate (PEM). Relative paths resolve from the repository root. |
| `AZURE_FRONTIER_DEPLOYMENT` | Yes | Deployment name for the frontier role |
| `AZURE_CHEAP_DEPLOYMENT` | Yes | Deployment name for the cheap role |

### Routing a role to another provider

| Variable | Values | Purpose |
|---|---|---|
| `MAPS_FRONTIER_PROVIDER` | `azure` (default), `openai`, `anthropic`, `google`, `local` | Provider for the frontier role |
| `MAPS_FRONTIER_MODEL` | Model name | Required when the frontier provider is not Azure |
| `MAPS_CHEAP_PROVIDER` | As above | Provider for the cheap role |
| `MAPS_CHEAP_MODEL` | Model name | Required when the cheap provider is not Azure |

### Provider credentials

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `GOOGLE_API_KEY` | Google Gemini API key |
| `OLLAMA_BASE_URL` | Base URL of an Ollama server, for example `http://127.0.0.1:11434` |
| `OLLAMA_MODEL` | Local model name. Default `qwen2:7b`. |

Keys can also be stored through **Settings**. They are sealed with the master key and picked up by the running worker on its next dispatch, with no restart. A key set in the environment always takes precedence over a stored key, and among stored keys for a provider the newest wins. Session-only keys are not supported: the worker is a separate process and could never read them.

### Reasoning effort

For reasoning models (the `gpt-5` family and the `o` series), the dispatcher requests the highest reasoning effort each model accepts: `xhigh` for `gpt-5.2` and later and for `codex-max` models, and `high` otherwise. A caller that sets its own effort overrides this.

## 2. Security

| Variable | Default | Purpose |
|---|---|---|
| `MAPS_MASTER_KEY` | none | 32-byte key (64 hex characters) for AES-256-GCM envelope encryption of stored provider keys. Generate with `openssl rand -hex 32`. Required only to store keys through the application. Never commit it. |
| `MAPS_BIND` | `127.0.0.1` | Host interface Docker publishes the application on. Set `0.0.0.0` only behind an instance passphrase and on a network you trust. |
| `MAPS_PORT` | `3100` | Host port for the web application |
| `MAPS_ALLOWED_HOSTS` | none | Comma-separated host names, besides `localhost`, `127.0.0.1` and `::1`, that browsers may use to reach the API, for example `maps.lab.example,192.168.1.20`. Requests addressed to any other host are refused, which blocks DNS-rebinding attacks from other websites. Set it when serving MAPS on a LAN address or behind a reverse proxy. |

The instance passphrase itself is set in **Settings**, not in the environment.

## 3. Manuscript parsing

| Variable | Default | Purpose |
|---|---|---|
| `GROBID_URL` | `http://127.0.0.1:8070` (native); `http://grobid:8070` (container) | GROBID service used to structure PDF manuscripts. The bundled compose file runs GROBID and sets this automatically. |

GROBID is required for PDF manuscripts. When it is unreachable, the review stops with the error class `parse_failed` and can be retried from the run page once GROBID is available. DOCX manuscripts are parsed locally and do not need GROBID.

## 4. Reference verification

| Variable | Purpose |
|---|---|
| `MAPS_CONTACT_EMAIL` | Contact address sent to Crossref and OpenAlex for their polite pools. A blank value is not sent. |
| `OPENALEX_API_KEY` | Optional OpenAlex key for higher rate limits |
| `SEMANTIC_SCHOLAR_API_KEY` | Optional Semantic Scholar key for higher rate limits |

Only `api.crossref.org`, `api.openalex.org`, and `api.semanticscholar.org` are reachable through the egress guard.

## 5. Cost accounting

| Variable | Purpose |
|---|---|
| `MAPS_PRICING_<MODEL>` | Per-model price override in US dollars per million tokens, as `input,cached,output`. The model name is upper-cased, with non-alphanumerics replaced by underscores. For example, `MAPS_PRICING_GPT_5_1=0.625,0.0625,5.00` prices a Batch or Flex deployment. |

Built-in prices use standard list rates. A model with neither a built-in price nor an override records a cost of zero and is invisible to the cost ceiling, so set an override for any custom deployment name.

The **cost ceiling** is set in **Settings** (global) or per run. Before every dispatch the engine projects the spend; if the next call would cross the ceiling, the run pauses cleanly with reason `cost_ceiling` and can be resumed after the ceiling is raised.

## 6. Worker and runtime

| Variable | Default | Purpose |
|---|---|---|
| `MAPS_DISPATCH_TIMEOUT_MS` | `300000` | Per-dispatch timeout. A timed-out dispatch restarts its phase, up to three times. On the last attempt, a unit that times out again is recorded as a coverage gap. |
| `MAPS_WORKER_POLL_MS` | `500` | Command and queue polling interval |
| `MAPS_AWAITING_INPUT_TIMEOUT_MS` | `86400000` (24 hours) | How long a review may wait for intake answers before it is paused |
| `MAPS_ROOT_DIR` | Repository root | Root for `data/`, `knowledge/`, and `agents/`. Set to `/app` in the container. |
| `MAPS_DB_PATH` | `data/maps.db` | Override for the primary database path. An installation created before the rename keeps using its existing `data/mara.db`. |
| `MAPS_LOG_MAX_BYTES` | `5242880` | Size at which a rotating log file rolls over |

## 7. Tracing (optional)

| Variable | Purpose |
|---|---|
| `LANGFUSE_HOST` | Langfuse endpoint. Content capture is permitted only when this resolves to the loopback interface. |
| `LANGFUSE_PUBLIC_KEY` | Langfuse public key |
| `LANGFUSE_SECRET_KEY` | Langfuse secret key |

When these are absent, tracing is skipped silently. Prompt and completion capture is a separate opt-in in **Settings**.

## 8. Application settings

The following are set in **Settings** and stored in the database rather than the environment:

| Setting | Purpose |
|---|---|
| Instance passphrase | Protects the web application and API |
| Default tier | `fast`, `balanced`, or `thorough`; applied to new reviews without a restart |
| Cost ceiling | Global spend limit per run |
| Telemetry | Anonymous run timings, kept on this instance only |
| Provider keys | Encrypted provider credentials |
