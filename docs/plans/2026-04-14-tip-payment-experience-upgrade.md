# Tip Payment Experience Upgrade Plan

Goal: turn the Discourse tip payment modal into a product-quality payment surface with clear staged flow, Fiber Link branding, richer payment context, and a polished success state suitable for visual acceptance screenshots.

Scope:
- upgrade the topic/reply tip modal UI in `fiber-link-discourse-plugin`
- keep current RPC contract (`tip.create`, `tip.status`) working
- introduce a branded payment experience with Fiber Link logo + link to `https://fiberlink.me/`
- preserve automated system coverage for invoice generation, pending, and settled states

Implementation outline:
1. inspect the existing modal + system spec and keep behavior coverage while changing the presentation
2. add/expand system expectations first for branded staged UI states
3. rework the Glimmer modal component into staged states: amount setup, payment request, success
4. add dedicated modal stylesheet(s) for polished layout, branded header, payment card, status timeline, and responsive behavior
5. verify with targeted plugin system specs, then open a PR from a fresh branch
