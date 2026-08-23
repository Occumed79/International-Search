# Standing Project Instructions

These rules are explicit user requirements for all future work on this repository.

## Architecture

- This is a **single integrated application**. Do not split core functionality into separate user-managed tools or workflows unless the user explicitly requests that architecture.
- **Neon is the single canonical persistent database** for this app, accessed through `NEON_DATABASE_URL` only. Do not introduce `DATABASE_URL` or another database fallback without explicit approval.
- Existing provider, agreement/network, pricing, service-availability, and related operational data must be available directly from persistent storage when the app opens.
- **Do not introduce a user-facing upload/import requirement for core application data.** Data migrations, seed operations, and refreshes are backend/deployment maintenance and must not become a prerequisite for using the app unless the user explicitly asks for that workflow.
- Before introducing a new operational dependency, manual step, data store, fallback architecture, or separate workflow, verify that it was explicitly requested. Do not treat an implementation convenience as user approval.

## Integration behavior

- **Directory means “show me what is in our network.”** Directory and the other network-analysis workspaces operate on the canonical Occu-Med provider dataset already stored in Neon.
- **Search means “show me what is not in our network.”** Search is an outside-network discovery / network-expansion workflow and must not return existing Occu-Med Directory providers as search results.
- Outside-network Search must compare discovered candidates against the current Occu-Med provider Directory and exclude confirmed existing-network matches from its displayed results.
- Do not add an `Occu-Med Network` result tab back to Search. Users who want existing-network providers should use Directory, Map, Coverage, Organizations, Pricing, Service Availability, Insights, or Coverage Gaps.
- Keep explicit service availability separate from pricing; do not infer service availability merely because a price exists.
- Keenable and TinyFish are the primary outside-network discovery APIs.
- Exa is fallback-only.
- Serper is removed and should not be reintroduced without explicit approval.
- This app supports both U.S. and international provider sourcing; it is not the Insight Hub 2 company-location tool.

## Frontend preservation

- **Preserve the established frontend, visual identity, navigation shell, and interaction patterns unless the user explicitly requests a redesign.** Functional repurposing, new APIs, database changes, or new sourcing logic do not authorize a visual redesign.
- Keep Global Intelligence as the visible application identity and add capabilities inside the same integrated interface rather than replacing the application.
- **Use the approved global palette across every user-facing tab and workspace:** `#FFFEFE`, `#EEF2F6`, `#B6C7D6`, `#4B6F93`, and `#1E2A3A`. Do not reintroduce the prior purple/violet/maroon theme unless the user explicitly requests another palette.
- Apply that palette consistently to Search, Map, Directory, Coverage, Organizations, Pricing, Service Availability, Insights, Coverage Gaps, provider cards, provider detail panels, Bookmarks, History, navigation, hover/active states, loading/empty states, tables, filters, and scrollbars.
- The HTML Command Center design remains an approved **additive analytical workspace** inside Global Intelligence, but it must not create a second navigation hierarchy inside the page.
- **The global header is the workspace navigation.** Do not restore an internal Command Center tab strip or a generic `Command Center` header button. The top navigation should expose **Map, Directory, Coverage, Organizations, Pricing, Service Availability, Insights, and Coverage Gaps** as peer workspaces alongside Search, Bookmarks, and History.
- **Map is the default analytical workspace.** Preserve the worldwide view when no meaningful provider/geography filter is active because the network is international.
- Do not restore the old generic top summary/title card containing copy such as `All Clinics` / `Individual provider locations`. Each workspace should use its own concise content heading only where useful.
- The left sidebar Occu-Med wordmark must be visually centered. Do not offset or misalign it inside the sidebar.
- Preserve the provider filter system: network/name search, detail/location search, network status, visibility, 2026 activity, documented services with ANY/ALL matching, country, state/region, facility type, grouping, sorting, and filtered-network counts where relevant.
- The map must use **MapTiler**, not Leaflet, and preserve **one physical clinic per point with no clustering/entity collapsing**.
- Map points must use a visible glow treatment. The user must be able to control the map display by **agreement status, service category, and provider/facility type**, and choose how map points are colored.
- Clicking/selecting a map point must reveal useful clinic information. Do not show a redundant popup card plus the same clinic again in the side panel; the selected clinic should be represented once in the detail area and excluded from the repeated location list.
- Filtered map searches must auto-fit to the filtered result geography; an organization filtered to South Africa, for example, must not remain centered on North America. The unfiltered state must retain the worldwide view.
- Use the user-facing label **Service Availability**, not `Line Item Availability` or `Line Item Service Availability`.
- **Do not expose Data Quality, Source Audit, or Diagnostics as user-facing tabs/routes.** These were explicitly removed from the product navigation.
- Insights must perform actual analysis of the stored provider, agreement, service, availability, and pricing information rather than merely restating totals. It should surface concentration, network strength, pricing coverage, service documentation, and similar useful findings.
- Coverage Gaps must specifically help identify U.S. network-presence gaps and strong-coverage areas across all 50 states and DC. Make clear when a metric describes network presence rather than population-adjusted market sufficiency.
- Provider, pricing, availability, coverage, organization, map, and analytical views must use the **same active provider-filter context**. Do not show a sidebar filter for one organization while presenting unrelated pricing or service-availability records.
- Distinguish filtered metrics from global metrics. Do not mix global KPI totals with filtered result tables in a way that implies they describe the same dataset.
- Use the same Occu-Med wordmark/brand asset used by the Insight Hub landing page on the main provider-search hero.
- **Do not add a portal switcher/drop-down menu to this app.** The header may link back to the Hub, but Global Intelligence does not need to reproduce the Hub's portal selector.
- Do not display `Portal 5` or similar internal portal numbering in normal user-facing navigation.
- **Do not expose backend implementation details, vendor/API names, fallback order, connector brands, database technology, or provider-routing logic in user-facing copy.** In particular, names such as Keenable, TinyFish, Exa, Serper, Neon, or similar infrastructure/vendor identifiers must remain backend-only unless the user explicitly asks to display them.
- User-facing language should describe outcomes and functions: outside-network provider search, Occu-Med Directory, pricing, availability, agreements, services, coverage, insights, and network gaps.
- Do not rename the visible application identity or browser title as a side effect of backend or product-function changes unless the user explicitly requests those visible changes.

## Change discipline

- Preserve existing integrated capabilities when repurposing or extending the app instead of replacing them with a simplified substitute.
- Do not make unapproved product or architecture assumptions. When the requested outcome is clear, implement it directly within the established architecture.
