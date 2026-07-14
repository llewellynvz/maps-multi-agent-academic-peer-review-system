# MARA

MARA is an autonomous, multi-agent peer-review system for psychology and wellbeing-science manuscripts. It runs entirely on your own machine.

- A rigorous third reviewer that sits beside the author. It produces a developmental peer-review report, a private editor summary, and both as branded Word documents.
- Everything runs locally in one container. Your manuscript, the reviewer's findings, and your provider keys never leave your machine.
- Bring one model provider (Azure OpenAI, OpenAI, Anthropic, Google, or a local Ollama model) and a laptop with Docker.

Source-available under PolyForm Noncommercial 1.0.0. This is not open source: private local modification is allowed, redistribution of derivatives is not, and commercial use needs written permission from Psynalytics.

MARA is developmental pre-submission support. It is not affiliated with any journal and is never a substitute for human peer review.

## Quickstart

You need Docker (Docker Desktop or Docker Engine) and one model-provider key. From a clean clone, three steps take you to a running review.

1. Create your environment file, then set two values in it.

   ```
   cp .env.example .env
   ```

   Open `.env` and set:
   - `MARA_MASTER_KEY` to a 32-byte key. Generate one with `openssl rand -hex 32`.
   - Either the four `AZURE_*` lines for Azure OpenAI, or a single provider key: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, or `OLLAMA_BASE_URL`.

2. Start MARA.

   ```
   docker compose up -d
   ```

   The first start builds the image, runs the database migrations, and starts the web app and the review worker together. Check it is ready with `docker compose ps` (the `mara` service reports healthy).

3. Open `http://localhost:3100` in your browser.

   Upload a PDF or DOCX manuscript, answer the short set-up questions, and MARA runs the full review. Download the report and the editor summary from the results screen.

Stop MARA with `docker compose down`. Your data stays in `./data`.

## Optional: higher-fidelity PDF parsing (GROBID)

The default image parses PDFs with a built-in fallback, so it works with no extra services. For richer reference and section extraction, enable the GROBID sidecar:

1. Set `GROBID_URL=http://grobid:8070` in `.env`.
2. Start with the profile:

   ```
   docker compose --profile grobid up -d
   ```

GROBID is memory-hungry: allow roughly 4 GB of RAM for it on top of MARA. On a machine with 8 GB or less, prefer the default fallback parser.

## Optional: tracing with Langfuse

If you run Langfuse on the host, set `LANGFUSE_HOST` (default `http://host.docker.internal:3000`), `LANGFUSE_PUBLIC_KEY`, and `LANGFUSE_SECRET_KEY` in `.env`. When these are absent, MARA runs on its local statistics panel alone and tracing is skipped. A missing Langfuse is never an error.

## Hardware

Reference machine: 4 vCPU, 16 GB RAM, SSD. A full review on the Fast preset uses your provider's API and typically completes in a few minutes. Cost depends on your provider and manuscript length.

## Data and privacy

All state lives in `./data`: the SQLite databases, uploaded manuscripts, generated documents, and rotating operational logs under `./data/logs`. Nothing leaves the machine except calls to your chosen model provider and, if you enable it, your own Langfuse instance.
