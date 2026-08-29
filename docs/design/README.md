# Lafia Hub design foundation

These concept boards are the Phase 1 visual source of truth:

- `customer-discovery-concept.png`
- `merchant-dashboard-concept.png`
- `admin-control-center-concept.png`

They were generated from the master build specification before implementation. All application text, controls, navigation, tables, charts, and icons remain code-native. The images are design references only and are not rendered as application UI.

## Visual direction

Lafia Hub should feel like a calm, trustworthy local utility for Lafia: modern without looking futuristic, locally grounded without relying on stereotypes, and spacious without feeling empty.

| Token | Value | Use |
| --- | --- | --- |
| Canvas | `#f8fafc` | Secondary page bands and dashboard canvas |
| Surface | `#ffffff` | Primary background and controls |
| Ink | `#0f172a` | Headlines and high-emphasis text |
| Body | `#334155` | Body copy and labels |
| Muted | `#64748b` | Supporting text |
| Primary | `#2557e8` | Primary actions and selected navigation |
| Primary hover | `#1d4ed8` | Hover/pressed actions |
| Intelligence | `#6d45e8` | Restrained Ask/AI accents |
| Coral | `#ef6359` | Warnings and human warmth, used sparingly |
| Border | `#e2e8f0` | Decorative boundaries |
| Focus | `#1d4ed8` | Keyboard focus ring |
| Success | `#15803d` | Positive statuses with text/icon support |
| Warning | `#b45309` | Pending statuses with text/icon support |
| Danger | `#b91c1c` | Destructive actions with confirmation |

Use Geist with system fallbacks, a 4px spacing base, 16–20px radii, light borders, restrained shadows, 44px minimum touch targets, and 150–200ms transitions. Respect reduced-motion preferences.

## Container and component rules

- Customer surfaces use a quiet header, open hero composition, horizontal category rail on small screens, and mobile bottom navigation.
- Merchant surfaces use a left rail on desktop and bottom navigation on mobile.
- Admin surfaces are desktop-first with an operational sidebar, tables/lists, and panels only where data grouping requires them.
- Ask Lafia is always the dominant customer action.
- Icons use the Lucide rounded-outline family at a consistent optical weight.
- Status is never communicated by colour alone.
- No glassmorphism, neon/glow, excessive gradients, generic AI robot imagery, nested card grids, or decorative filler.

## Above-the-fold copy lock

The customer home first viewport may use only the following visible product copy from the specification and concept:

- Lafia Hub
- Making Lafia Searchable.
- Lafia, Nasarawa State
- Merchant sign in
- What do you need in Lafia?
- Ask for a product, service or business and Lafia Hub will help you find the best nearby options.
- Ask for anything in Lafia...
- Birthday cake under ₦20k near Shendam Road
- Phone repair near me
- Photographer for Saturday
- Quiet restaurant for dinner tonight

No eyebrow, kicker, decorative badge, or extra product claim should be added above the heading.

## Media treatment

Phase 1 uses code-native, non-copyrighted abstract merchant covers. No colour wash or overlay is applied to a photographic hero because the concept has no hero image. Future merchant imagery must come from approved storage assets or appropriately licensed/generated media and must retain explicit demo provenance until verified.

## Intentional concept constraints

- The network mark is provisional because the referenced brand artwork was not attached. It is built as a replaceable code-native mark.
- Data values and merchant names visible in concept boards are layout references, not approved facts. Application fixtures must be fictional, internally marked `demo`, and visibly identified as demonstration data.
- Non-Lafia rows and large platform metrics visible in the admin concept must not be copied into the product.
- The concept's partially visible extra customer section is not part of the Phase 1 copy lock and may be omitted until its content is specified.
