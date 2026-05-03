# Fiber Link Discourse Plugin Compatibility

## Minimum supported requirement for tip-button placement

The tip action placement introduced in PR #326 / issue #341 requires a Discourse plugin API that supports:

- `withPluginApi(...)`
- `api.registerValueTransformer("post-menu-buttons", ...)`

This plugin now treats that API surface as the minimum supported environment for the per-post tip action UI.

## What this means

- The `Tip` action is intentionally rendered as a **post-level action** in the post action row.
- Topic posts and replies use the same placement pattern.
- The previous article-header / post-body fallback placement is no longer supported.

## Operator note

If an install does not provide `registerValueTransformer("post-menu-buttons", ...)`, it should be considered below the minimum supported version for this UI behavior and should be upgraded rather than patched with a legacy placement fallback.
