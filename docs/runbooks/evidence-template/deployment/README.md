# Deployment Evidence Template

This template defines the required folder layout for one deployment evidence bundle.

Expected structure:

```text
<timestamp>/
  commands/
    command-index.log
  logs/
    compose-services.log
  node/
    fnn-container-inspect.json
    rpc-container-inspect.json
    worker-container-inspect.json
  ids/
    invoice-id.txt
    settlement-id.txt
  snapshots/
    compose-ps.txt
    compose-config.txt
  status/
    step-results.tsv
    acceptance-mapping.md
  metadata/
    manifest.json
    retention-policy.md
```

The capture command is:

```bash
scripts/capture-deployment-evidence.sh --invoice-id <invoice_id> --settlement-id <settlement_id_or_tx_hash>
```
