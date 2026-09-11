# LocalHub agent and tool contract

## Governance

ATLAS is the master orchestration agent. It receives Founder directives, inspects approved LocalHub data, coordinates specialists, proposes actions, requests approval, tracks execution, and summarizes outcomes. It does not receive unrestricted database, Supabase service-role, payment, messaging, or infrastructure credentials.

Specialist boundaries are:

- **SHOPKEEPER:** vendor operations.
- **CONCIERGE:** customer support and product discovery.
- **ORDERGUARD:** orders and fulfilment.
- **TREASURER:** revenue, commissions, and finance intelligence.
- **GROWTH:** acquisition, referrals, and expansion.
- **TRENDHUNTER:** market and competitor intelligence.

These are target interfaces, not evidence that all agents or tools are implemented.

The simulator-only Seller Response Control Loop v1 is the first bounded
coordination implementation across three of these interfaces. ATLAS is the only
orchestrator; ORDERGUARD owns the case state; SHOPKEEPER owns the simulated
seller request and manual-review fallback. The loop emits immutable evidence but
does not enable `contact_vendor` or any other external tool.

## Controlled gateway

Planned tools include `get_platform_summary`, `get_revenue_report`, `get_order`, `get_order_issues`, `get_vendor`, `get_vendor_status`, `get_demand_gaps`, `get_search_trends`, `get_unmet_demand`, `create_referral_mission`, `contact_customer`, `contact_vendor`, `generate_campaign`, `publish_campaign`, `get_campaign_performance`, `recommend_growth_actions`, `get_system_health`, and `get_incidents`.

Every tool must define validated inputs/outputs, authorization and role scope, rate/error handling, audit logs, and safe redaction. Mutating, external-contact, publishing, financial, or privileged actions require explicit approval policy and reversible auditability.

Step 28 implements the first internal boundary only: a server-only,
provider-neutral `get_platform_summary` GREEN tool for an authenticated, active
`super_admin`, scoped to one required active market. It returns only bounded
non-PII live-catalog counts and creates bounded rate-limit/audit control evidence.
There is no HTTP route, AI/provider invocation, external effect, or domain
mutation. The exact contract and activation gates are in
`docs/LOCALHUB_TOOL_GATEWAY_CONTRACT.md`.

All other planned tools remain registry-described but unavailable. Read tools are
GREEN only after their individual scope and data contracts are verified.
`create_referral_mission`, customer/vendor contact, and campaign publishing are
YELLOW and require an explicit approval artifact. Credential access, deletion,
money transfer, irreversible infrastructure mutation, and security-control
changes are RED and are not exposed.

## Decision rules

Agents may choose normal implementation details. They must escalate changes to product scope, brand, architecture, pricing, legal/payment terms, credentials, external contact, or production deployment. Referral percentages/durations, settlement/escrow, disputes, payouts, and merchant legal verification remain Founder decisions.
