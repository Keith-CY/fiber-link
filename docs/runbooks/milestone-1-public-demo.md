# Milestone 1 Public Demo Proof (Template)

This document defines the Milestone 1 public proof scope and verification checklist.

## Scope note
This PR is a template-only proof document and review checklist.

Public proof links:
- Discourse thread (demo discovery): https://talk.nervos.org/t/dis-fiber-link-a-ckb-fiber-based-pay-layer-tipping-micropayments-for-communities/9845
- Short demo video: pending and tracked in issue [#97](https://github.com/Keith-CY/fiber-link/issues/97)

## Verification timestamps

- 00:00-00:20 — Open the public Discourse demo and open the tip composer on a post/reply.
- 00:20-00:45 — Submit a tip request and display the generated invoice/QR.
- 00:45-01:20 — Pay the invoice and observe settlement status update in the UI.
- 01:20-01:45 — Verify recipient internal ledger balance increases after settlement.
- 01:45-02:00 — Submit a withdrawal request and show tx completion evidence (or pending queue + retry-safe state if execution is mock).
