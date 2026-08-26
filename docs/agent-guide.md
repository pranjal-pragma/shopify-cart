# Agent Guide

## Mandatory workflow

1. Read [README.md](README.md) and the document related to the area being changed.
2. Inspect the existing implementation before choosing an approach.
3. Keep changes scoped and preserve established contracts unless the task explicitly changes
   them.
4. Run the checks listed in [development.md](development.md) for every affected layer.
5. Update this memory bank whenever behavior, architecture, contracts, setup, or decisions
   change.
6. Commit completed changes. The project owner expects a commit for every finished change.

## Documentation rules

- Update `architecture.md` when modules, storage, request flow, or integrations change.
- Update `cart-contracts.md` when configuration fields, browser APIs, events, selectors, CSS
  prefixes, cart attributes, or extension assets change.
- Update `development.md` when commands, prerequisites, ports, environment keys, or test
  expectations change.
- Add an entry to `decisions.md` for choices that future agents should not casually reverse.
- Keep documents concise, current, and based on code that exists in this repository.
- Never document secret values. Refer to environment variable names only.

## Change safety

- `theme-src` is the source of truth for storefront JavaScript. Rebuild it after editing.
- Theme extension asset files are generated but tracked; include rebuilt assets in commits.
- The free-gift drawer label is not enough to make an item free at checkout. Keep the theme
  cart marker and Discount Function query synchronized.
- Shopify extension handles and UIDs affect activation and development previews. Update all
  activation links and manifests together when changing them.
- The application may run inside Shopify Admin. Preserve App Bridge token exchange and embedded
  navigation behavior.

## Definition of done

A change is complete when implementation, generated artifacts, tests, memory-bank updates, and
the requested commit are all present. Report any check that could not be run.

