# Occu-Med Provider Sourcing & Network Intelligence

## Overview

A sourcing and network-management portal that searches Occu-Med's existing provider network first, evaluates documented service coverage and agreement status, and optionally discovers new providers outside the network when coverage is insufficient.

The application is no longer international-only. It supports U.S. and international sourcing workflows.

## Core Workflow

1. Import the existing Occu-Med Network Command Center snapshot.
2. Import its embedded pricing and explicit clinic-component availability intelligence from the same HTML file.
3. Search the existing network by provider/network, geography, facility type, and documented services.
4. Merge legacy service tags with explicit line-item availability before scoring the requirement.
5. Prioritize full-match Active Agreement providers.
6. Surface known line-item pricing and availability on existing-provider drill-downs.
7. When existing coverage is weak—or when the user explicitly requests it—search outside the network.
8. Use Keenable + TinyFish as the primary external discovery layer.
9. Use Exa only when primary external coverage is low.
10. Label outside results as new candidates or possible existing-network matches.

## Existing Network Snapshot

The `/api/network/import` endpoint accepts the self-contained Occu-Med Network Command Center HTML, a compatible JSON snapshot, or a gzipped JSON snapshot. The embedded Command Center `PAYLOAD` is decoded and normalized into a PostgreSQL `network_provider_snapshot` table.

Imported operational fields include:
- Provider / clinic / organization identity
- Facility type
- Network / agreement status
- Visibility
- Country, state/region, city, address, postal code
- GPS coordinates
- Phone
- Documented services
- Last appointment
- Pricing-availability flag
- Agreement / service component identifiers
- 2026 activity and source status

## Pricing & Explicit Availability

The `/api/network/import-intelligence` endpoint reads the Command Center `AUX_PAYLOAD` from the same HTML file and imports:
- latest known pricing line items per canonical clinic + component
- source price text and numeric price where available
- effective / expiration / line-item-created dates
- explicit clinic-component availability links
- component types

Pricing and availability remain separate. A service is not treated as available merely because a price exists.

Requirement matching uses both the original provider service tags and the explicit availability links. Existing provider details can retrieve the original pricing and availability line items using the canonical Command Center clinic ID.

## External Discovery

- **Keenable** — primary web discovery
- **TinyFish Search + Fetch** — primary discovery and content enrichment
- **Exa** — fallback only

External discovery can be disabled, run only when existing-network coverage has gaps, or forced even when existing coverage is sufficient.

## Stack

- pnpm workspaces
- Node.js 24
- TypeScript 5.9
- React 19 + Vite + Tailwind CSS
- Express 5
- PostgreSQL + Drizzle ORM
- Zod / drizzle-zod
- esbuild

## Main API Routes

- `POST /api/network/import` — import/refresh core Command Center provider snapshot
- `POST /api/network/import-intelligence` — import pricing + explicit availability from Command Center AUX payload
- `GET /api/network/stats` — existing-network counts and snapshot status
- `GET /api/network/intelligence-stats` — pricing / availability intelligence counts
- `GET /api/network/search` — search normalized existing-network records
- `GET /api/network/intelligence/:externalId` — retrieve pricing and explicit availability for one canonical clinic
- `POST /api/sourcing/search` — requirement-based existing-network search plus optional external sourcing

Legacy provider/price/bookmark/history routes remain in the repository for compatibility while the application is repurposed.
