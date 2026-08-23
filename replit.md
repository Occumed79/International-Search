# Occu-Med Provider Sourcing & Network Intelligence

## Overview

A single integrated sourcing and network-management portal backed by a persistent Neon Postgres database. It searches Occu-Med's existing provider network first, evaluates documented service coverage, agreement status, pricing and explicit availability, and optionally discovers new providers outside the network when existing coverage is insufficient.

The application supports both U.S. and international sourcing workflows.

## Architecture Principles

- **Neon is the single canonical data store.** The application uses `NEON_DATABASE_URL` exclusively.
- Existing provider/network data is stored persistently in Neon and is available when the app opens.
- Pricing and explicit service availability are stored in Neon as separate datasets and are never inferred from one another.
- There is no user-facing snapshot upload/import workflow.
- Data migrations or refreshes are deployment/data-maintenance operations, not required steps for application users.
- Existing-network search always precedes optional outside-network discovery.

## Core Workflow

1. Search the persistent Occu-Med network by provider/network, geography, facility type, and documented services.
2. Merge provider service tags with explicit clinic-component availability before scoring the requirement.
3. Prioritize full-match Active Agreement providers.
4. Surface known line-item pricing, explicit availability, last use and network status on provider results/drill-downs.
5. When existing coverage is weak—or when the user explicitly requests it—search outside the network.
6. Use Keenable + TinyFish as the primary external discovery layer.
7. Use Exa only when primary external coverage is low.
8. Label outside results as new candidates or possible existing-network matches.

## Persistent Network Data

Neon stores the integrated provider intelligence in three operational datasets:

### `network_provider_snapshot`
Provider / clinic / organization identity, facility type, agreement/network status, geography, GPS, phone, documented services, last appointment, pricing indicator, agreement/service component identifiers, 2026 activity and source status.

### `network_pricing_snapshot`
Latest known pricing line items by canonical clinic and component, including numeric price where available, source price text, and effective/expiration/line-item dates.

### `network_availability_snapshot`
Explicit clinic-component availability links and component type by canonical clinic.

Pricing and availability remain separate. A service is not treated as available merely because a price exists.

## External Discovery

- **Keenable** — primary web discovery
- **TinyFish Search + Fetch** — primary discovery and content enrichment
- **Exa** — fallback only

Outside-network discovery can be disabled, run only when existing-network coverage has gaps, or forced even when existing coverage is sufficient.

## Stack

- pnpm workspaces
- Node.js 24
- TypeScript 5.9
- React 19 + Vite + Tailwind CSS
- Express 5
- Neon Postgres + Drizzle ORM
- Zod / drizzle-zod
- esbuild

## Main API Routes

- `GET /api/network/stats` — persistent existing-network counts and status
- `GET /api/network/intelligence-stats` — pricing / availability intelligence counts
- `GET /api/network/search` — search existing-network records in Neon
- `GET /api/network/intelligence/:externalId` — retrieve pricing and explicit availability for one canonical clinic
- `POST /api/sourcing/search` — requirement-based existing-network search plus optional external sourcing

Legacy provider/price/bookmark/history routes remain for compatibility while the application is repurposed.
