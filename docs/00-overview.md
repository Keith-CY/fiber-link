# Fiber Link — Overview

## One-liner
**Fiber Link** is an open-source payment layer that enables instant, low-fee tipping and micropayments inside online communities (starting with a Discourse plugin), built on the **CKB Fiber Network**.

## Why
Online communities produce valuable content but monetization options are typically:
- Ads/sponsorships (misaligned incentives)
- Traditional payment processors (fees + geo restrictions)
- L1 transfers (slow confirmations, poor UX for small payments, key-management overhead)

CKB Fiber is designed for fast/low-cost payments, but adoption is blocked by operational requirements (receiver online, running a node, liquidity management).

## Core idea
Abstract Fiber complexity away from community members by introducing:
- An always-online **Hub Fiber node** with liquidity ("FNN")
- A lightweight **backend service + internal ledger**
- A **Discourse plugin** for the tipping UI and creator dashboard

## Custody boundary (MVP)
The MVP is a **hosted/custodial hub** model (similar to hosted Lightning wallets):
- Users pay invoices to the hub
- The service credits recipients in an internal ledger
- Recipients withdraw later (MVP: on-chain UDT transfer to a provided CKB address)

This requires explicit security and operational controls (limits, monitoring, key management).

## References
- Nervos Talk proposal thread: https://talk.nervos.org/t/dis-fiber-link-a-ckb-fiber-based-pay-layer-tipping-micropayments-for-communities/9845
