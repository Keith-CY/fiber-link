# Tip Payment Experience Upgrade Plan

Goal: turn the Discourse tip payment modal into a product-quality payment surface with clear staged flow, Fiber Link branding, richer payment context, and a polished success state suitable for visual acceptance screenshots.

Scope:

- upgrade the topic/reply tip modal UI in `fiber-link-discourse-plugin`
- keep current RPC contract (`tip.create`, `tip.status`) working
- introduce a branded payment experience with Fiber Link logo + link to `https://www.fiberlink.me`
- preserve automated system coverage for invoice generation, pending, and settled states

Current interaction direction:

- title the dialog as `Send a tip`, using the same tip icon family as the post-menu tip button
- present Fiber Link as payment-service attribution via `Powered by Fiber Link` in the dialog footer, with `Fiber Link` as the external link
- load the official Fiber Link logo from `https://fiberlink.me/brand/fiber-link-logo.png`
- keep the dialog compact and refined, with a square, centered close control and no header/footer divider lines
- lead with the large amount and `Tipping @recipient`, then show the forum avatar recipient strip with `Receives <amount>CKB`
- present context as a two-cell meta row with `Topic` or `Reply context` first and `Network` second
- separate the summary and Step 1 with clear spacing while avoiding an enclosing card border
- keep Step 1 focused on amount and optional message with an open layout, no redundant title/caption, soft surfaces, and no gradient color
- use the current standalone modal direction: off-white surfaces, black primary action, compact mono labels, and restrained status color
- align the modal header/footer density to the standalone comp by treating their 72px/77px heights as total box height rather than content plus padding
- keep the step header's right-side stepper as two short horizontal bars: Step 1 highlights the first bar, Step 2 highlights both
- style quick amounts as equal-width 32px-tall pills with black selected state and transparent inactive state
- use `Leave a short note` as the optional message placeholder, without extra reaction or markdown helper text below the field
- select the `Custom` amount chip whenever the typed CKB amount does not match a preset quick amount
- label the first-step CTA as `Review & Pay`
- keep the second step visually calm: no progress dots, clear space between `Step 02` and `Pay with Wallet`, and no automatic-status helper copy
- show the pending state as a compact loading spinner plus `Awaiting payment`; polling remains automatic without a footer `Check status` button
- decorate the QR card with the standalone comp's top-left and bottom-right black corner marks
- hide the `Expires in` timer until the RPC result includes real invoice expiration data; keep the timer structure ready for a future dynamic progress bar
- keep invoice copy as an icon-only control with a centered visible icon on hover: default copy icon, copied check icon, and a 3-second `Copied` title/aria state before reset
- keep `Open Fiber Wallet` visible but disabled with a semi-transparent, non-clickable appearance for now, and avoid exposing raw invoice/payment details through a `More options` panel
- do not display fee information in the tip dialog

Dashboard replication direction:

- match the provided Dashboard comp while keeping `/fiber-link` as a normal embedded Discourse page with the standard Discourse chrome visible
- expose `/fiber-link` from the logged-in user's profile menu as `Fiber Link Dashboard`
- keep the Dashboard surface transparent so it inherits the Discourse embedded page background instead of painting a separate block
- keep the hero, summary metrics, withdraw panel, and recent activity table open and border-light rather than card-based
- keep Dashboard title weights one step lighter than the standalone comp so the embedded page feels calmer inside Discourse
- expose auto-refresh as a compact dropdown with `10s`, `30s`, and `60s` options
- keep the live sync label stable during background refreshes to avoid visible flicker
- keep the withdrawal minimum visible and enforce the current 61 CKB threshold in the UI
- keep the withdrawal destination error hidden on initial render; disable submit until a destination is present, avoid blue focus rings on withdrawal inputs, and only surface the missing-address validation after a submit attempt
- provide amount shortcuts for `25%`, `50%`, `75%`, and `Max`, clamped by the minimum withdrawal and available balance
- show a clear paste failure reminder when clipboard access is unavailable or denied
- use a toast for successful withdrawal requests instead of inserting a success banner inside the withdraw panel
- keep the withdrawal action area concise without the extra funds-sent footnote
- keep the recent-activity search field compact, with the icon and text scaled down with the control
- hide the `View full ledger` link until a ledger detail workflow is designed

Implementation outline:

1. inspect the existing modal + system spec and keep behavior coverage while changing the presentation
2. add/expand system expectations first for branded staged UI states
3. rework the Glimmer modal component into staged states: amount setup, payment request, success
4. add dedicated modal stylesheet(s) for polished layout, branded header, payment card, status timeline, and responsive behavior
5. verify with targeted plugin system specs, then open a PR from a fresh branch
