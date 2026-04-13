# Global Self-Pay Price Intelligence

## Overview

A production-style web portal for searching real posted out-of-pocket healthcare prices across the United States and internationally. Built with a premium Apple macOS Tahoe glass aesthetic.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React 19 + Vite + Tailwind CSS + Leaflet maps
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Maps**: Leaflet + react-leaflet

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Architecture

### Frontend (artifacts/price-intel)
- React + Vite app with glass UI aesthetic
- Interactive Leaflet map with price markers
- Search with autocomplete suggestions
- Results panel with source badges and verification status
- Provider detail drawer with evidence display
- Pages: Home (search + map), Bookmarks, History, Admin Diagnostics

### Backend (artifacts/api-server)
- Express 5 REST API
- Routes: search, providers, bookmarks, stats, admin diagnostics
- Modular connector architecture for data sources

### Database Schema (lib/db)
- **providers** — healthcare provider/facility records with geo coordinates
- **prices** — posted price evidence with source URLs, verification status, confidence scores
- **bookmarks** — saved provider bookmarks
- **search_history** — search query tracking
- **crawl_logs** — data connector crawl status tracking

### Data Model
Each price record includes:
- Provider info (name, type, specialty, location, NPI)
- Exact posted price with currency and price type
- Source evidence (URL, text snippet, source type)
- Verification status (verified_exact_posted_price, likely_exact_price_needs_review, provider_found_no_price, rejected_non_qualifying_source)
- Confidence score (0-1)

### Source Types
- hospital_mrf — Hospital machine-readable transparency files
- provider_website — Provider website with posted pricing
- pdf_price_sheet — PDF price sheets/fee schedules
- cms_dataset — CMS Data datasets
- public_registry — Public provider registries

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
