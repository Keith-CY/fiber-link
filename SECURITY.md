# Security Policy

Fiber Link is a payment layer that moves real value over the CKB Fiber Network.
We take vulnerability reports seriously and appreciate coordinated disclosure.

## Reporting a Vulnerability

**Please do not open a public issue for security problems.**

Report vulnerabilities through GitHub's private vulnerability reporting:

1. Go to the repository's **Security** tab.
2. Click **Report a vulnerability** and fill in the advisory form.

Include as much of the following as you can:

- affected component (Discourse plugin, RPC service, worker, admin console, deploy stack);
- reproduction steps or proof of concept;
- impact assessment (e.g. fund loss, ledger inconsistency, privilege escalation, data exposure);
- suggested remediation if you have one.

You should receive an acknowledgment within 7 days. Please allow maintainers a
reasonable window to ship a fix before public disclosure.

## Scope

Reports of highest interest, roughly in priority order:

- theft or double-crediting of funds (ledger, settlement, withdrawal paths);
- HMAC authentication or replay-protection bypass on `/rpc`;
- privilege escalation in the admin console (role spoofing, cross-app access);
- key material exposure (hot-wallet withdrawal key, app HMAC secrets);
- injection or XSS in the Discourse plugin surfaces.

Out of scope: vulnerabilities in the CKB Fiber Network node (FNN) itself
(report upstream to [nervosnetwork/fiber](https://github.com/nervosnetwork/fiber)),
denial of service requiring unrealistic traffic volumes, and issues in
third-party dependencies without a demonstrated impact on Fiber Link.

## Security Model References

- [Threat Model](docs/05-threat-model.md)
- [Security Assumptions](docs/runbooks/security-assumptions.md)
- [Security Controls Evidence Map](docs/runbooks/security-controls-evidence-map.md)
- [Mainnet Deployment Checklist](docs/runbooks/mainnet-deployment-checklist.md)
