# Fiber Link Discourse Plugin

This repository is the standalone distribution mirror for the Fiber Link Discourse plugin.

The source of truth lives in the monorepo at:

- [`Keith-CY/fiber-link`](https://github.com/Keith-CY/fiber-link)
- subdirectory: [`fiber-link-discourse-plugin/`](https://github.com/Keith-CY/fiber-link/tree/main/fiber-link-discourse-plugin)

Changes to this mirror are synced from the monorepo by GitHub Actions.

## Install

For self-hosted Discourse, add this plugin repository to your Discourse container config and clone it into `plugins/fiber-link`, then rebuild the app.

```yaml
hooks:
  after_code:
    - exec:
        cd: $home/plugins
        cmd:
          - git clone https://github.com/Keith-CY/fiber-link-discourse-plugin.git fiber-link
```

## Configuration

After installation, configure these site settings in Discourse:

- `fiber_link_enabled`
- `fiber_link_service_url`
- `fiber_link_app_id`
- `fiber_link_app_secret`

These values must match the RPC service configuration used by Fiber Link.
