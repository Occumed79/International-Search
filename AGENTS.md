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
- Keep the existing Global Intelligence / Portal 5 shell and established page styling as the baseline. Add new capabilities inside that interface rather than replacing it with a new dashboard or command-center design.
- Do not rename the visible application, portal identity, primary navigation, or browser title as a side effect of backend or product-function changes unless the user explicitly requests those visible changes.

## Change discipline

- Preserve existing integrated capabilities when repurposing or extending the app instead of replacing them with a simplified substitute.
- Do not make unapproved product or architecture assumptions. When the requested outcome is clear, implement it directly within the established architecture.
