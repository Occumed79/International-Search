# Standing Project Instructions

These rules are explicit user requirements for all future work on this repository.

## Architecture

- This is a **single integrated application**. Do not split core functionality into separate user-managed tools or workflows unless the user explicitly requests that architecture.
- **Neon is the single canonical persistent database** for this app, accessed through `NEON_DATABASE_URL` only. Do not introduce `DATABASE_URL` or another database fallback without explicit approval.
- Existing provider, agreement/network, pricing, service-availability, and related operational data must be available directly from persistent storage when the app opens.
- **Do not introduce a user-facing upload/import requirement for core application data.** Data migrations, seed operations, and refreshes are backend/deployment maintenance and must not become a prerequisite for using the app unless the user explicitly asks for that workflow.
- Before introducing a new operational dependency, manual step, data store, fallback architecture, or separate workflow, verify that it was explicitly requested. Do not treat an implementation convenience as user approval.

## Integration behavior

- Search the existing Occu-Med network first.
- Keep explicit service availability separate from pricing; do not infer service availability merely because a price exists.
- Outside-network discovery is optional and secondary to the existing network.
- Keenable and TinyFish are the primary outside-network discovery APIs.
- Exa is fallback-only.
- Serper is removed and should not be reintroduced without explicit approval.
- This app supports both U.S. and international provider sourcing; it is not the Insight Hub 2 company-location tool.

## Frontend preservation

- **Preserve the established frontend, visual identity, navigation shell, and interaction patterns unless the user explicitly requests a redesign.** Functional repurposing, new APIs, database changes, or new sourcing logic do not authorize a visual redesign.
- Keep the existing Global Intelligence / Portal 5 shell and established page styling as the baseline. Add new capabilities inside that interface rather than replacing the application.
- **Use the approved global palette across every user-facing tab and workspace:** `#FFFEFE`, `#EEF2F6`, `#B6C7D6`, `#4B6F93`, and `#1E2A3A`. Do not reintroduce the prior purple/violet/maroon theme unless the user explicitly requests another palette.
- Apply that palette consistently to Search, Command Center, Map controls/markers, provider cards, provider detail panels, Bookmarks, History, Diagnostics, navigation, hover/active states, loading/empty states, tables, filters, and scrollbars.
- The HTML Command Center design is an approved **additive workspace** inside Portal 5. It must remain a full analytical workspace rather than a simplified provider-search substitute.
- Preserve the Command Center's core HTML feature set: **Directory, Map, Coverage, Organizations, Pricing, Line Item Availability, Data Quality, and Source Audit** plus its network-status, visibility, 2026-activity, documented-service, geography/facility, grouping, sorting, and filtered-snapshot controls unless the user explicitly asks to remove a capability.
- The Command Center map must use **MapTiler**, not Leaflet, and should preserve one physical clinic per point rather than silently clustering/entity-collapsing the network.
- Use the same Occu-Med wordmark/brand asset used by the Insight Hub landing page on the main provider-search hero.
- **Do not add a portal switcher/drop-down menu to this app.** The header may link back to the Hub, but Portal 5 does not need to reproduce the Hub's portal selector.
- **Do not expose backend implementation details, vendor/API names, fallback order, connector brands, database technology, or provider-routing logic in user-facing copy.** In particular, names such as Keenable, TinyFish, Exa, Serper, Neon, or similar infrastructure/vendor identifiers must remain backend-only unless the user explicitly asks to display them.
- User-facing language should describe outcomes and functions: provider search, Occu-Med Network, additional providers, pricing, availability, agreements, services, search scope, and system health.
- Diagnostics must sanitize connector/source labels rather than rendering raw backend connector or vendor names.
- Do not rename the visible application, portal identity, primary navigation, or browser title as a side effect of backend or product-function changes unless the user explicitly requests those visible changes.

## Change discipline

- Preserve existing integrated capabilities when repurposing or extending the app instead of replacing them with a simplified substitute.
- Do not make unapproved product or architecture assumptions. When the requested outcome is clear, implement it directly within the established architecture.
