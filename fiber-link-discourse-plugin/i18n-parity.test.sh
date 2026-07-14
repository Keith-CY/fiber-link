#!/usr/bin/env bash
# Verifies that every i18n("fiber_link.*") key referenced by the plugin's JS/GJS
# exists in client.en.yml AND client.zh_CN.yml, and that the two locales define
# the same fiber_link key set. A missing key renders as the raw key string in
# the UI, so this is the guardrail for the componentized i18n.
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

python3 - "$PLUGIN_DIR" <<'PY'
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("i18n-parity: PyYAML is required. Install it with 'pip install PyYAML'.", file=sys.stderr)
    sys.exit(1)

plugin_dir = Path(sys.argv[1])
assets_dir = plugin_dir / "assets" / "javascripts"
en_path = plugin_dir / "config" / "locales" / "client.en.yml"
zh_path = plugin_dir / "config" / "locales" / "client.zh_CN.yml"

# i18n("fiber_link....") in JS and {{i18n "fiber_link...."}} in templates.
key_pattern = re.compile(
    r"i18n\(\s*[\"'](fiber_link\.[A-Za-z0-9_.]+)[\"']"
    r"|{{\s*i18n\s+[\"'](fiber_link\.[A-Za-z0-9_.]+)[\"']"
)

used_keys = set()
for path in assets_dir.rglob("*"):
    if path.suffix not in {".js", ".gjs", ".hbs"}:
        continue
    text = path.read_text(encoding="utf-8")
    for match in key_pattern.finditer(text):
        used_keys.add(match.group(1) or match.group(2))

if not used_keys:
    print("i18n-parity: no fiber_link.* keys found in assets — extraction regex is broken")
    sys.exit(1)


def flatten(node, prefix=""):
    keys = {}
    if isinstance(node, dict):
        for raw_key, value in node.items():
            if not isinstance(raw_key, str):
                print(f"i18n-parity: non-string YAML key {raw_key!r} under '{prefix}' (yes/no/on/off must be quoted)")
                sys.exit(1)
            keys.update(flatten(value, f"{prefix}{raw_key}."))
    else:
        keys[prefix[:-1]] = node
    return keys


def locale_keys(path, root):
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    flat = flatten(data[root])
    return {k: v for k, v in flat.items() if k.startswith("js.fiber_link.")}

en_keys = locale_keys(en_path, "en")
zh_keys = locale_keys(zh_path, "zh_CN")

failures = []
for key in sorted(used_keys):
    yaml_key = f"js.{key}"
    if yaml_key not in en_keys:
        failures.append(f"missing in client.en.yml: {yaml_key}")
    if yaml_key not in zh_keys:
        failures.append(f"missing in client.zh_CN.yml: {yaml_key}")

en_only = set(en_keys) - set(zh_keys)
zh_only = set(zh_keys) - set(en_keys)
for key in sorted(en_only):
    failures.append(f"defined only in en: {key}")
for key in sorted(zh_only):
    failures.append(f"defined only in zh_CN: {key}")

# Interpolation placeholders must agree between locales so runtime lookups
# never reference a variable the caller does not pass.
placeholder = re.compile(r"%\{([a-zA-Z0-9_]+)\}")
for key in sorted(set(en_keys) & set(zh_keys)):
    en_vars = set(placeholder.findall(str(en_keys[key] or "")))
    zh_vars = set(placeholder.findall(str(zh_keys[key] or "")))
    if en_vars != zh_vars:
        failures.append(f"placeholder mismatch for {key}: en={sorted(en_vars)} zh={sorted(zh_vars)}")

if failures:
    print("i18n-parity FAILED:")
    for failure in failures:
        print(f"  - {failure}")
    sys.exit(1)

print(f"i18n-parity checks passed ({len(used_keys)} referenced keys, {len(en_keys)} en / {len(zh_keys)} zh_CN entries)")
PY
