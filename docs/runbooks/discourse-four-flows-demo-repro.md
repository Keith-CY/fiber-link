# Discourse 四流程演示复现手册（独立版）

本手册用于让用户独立复现以下 4 个流程，并拿到可归档证据：

1. Tip 按钮与弹窗（UI）
2. Discourse 对接后端接口（RPC）
3. 支付状态订阅 / 轮询（subscription + polling）
4. 创作者余额/历史 + 提现 + 区块链浏览器交易证明

## 1) 准备条件

- 目录：`<YOUR_LOCAL_REPO_PATH>/fiber-link`（或你的 worktree 路径）
- Docker Desktop 已启动
- 本地已具备：`jq` `expect` `curl` `openssl` `tar`
- Playwright wrapper：`~/.codex/skills/playwright/scripts/playwright_cli.sh`

进入目录：

```bash
cd <YOUR_LOCAL_REPO_PATH>/fiber-link
```

## 2) 一键完整跑（推荐）

```bash
scripts/capture-e2e-discourse-four-flows-evidence.sh \
  --explorer-tx-url-template 'https://pudge.explorer.nervos.org/transaction/{txHash}' \
  --headless
```

说明：

- 会自动执行四流程 e2e
- 自动打包证据目录 + 生成 `.tar.gz`
- 结束时终端会打印 `EVIDENCE_DIR` 和 `ARCHIVE`

## 3) 快速复跑（复用已启动服务）

当服务和论坛已在本机运行时，使用：

```bash
DISCOURSE_DEV_ROOT=/tmp/discourse-dev-fiber-link \
scripts/capture-e2e-discourse-four-flows-evidence.sh \
  --explorer-tx-url-template 'https://pudge.explorer.nervos.org/transaction/{txHash}' \
  --headless \
  --skip-services \
  --verbose
```

## 4) 结果与截图位置

运行完成后，关注终端最后两行：

- `SOURCE_ARTIFACT_DIR=...`：原始执行产物
- `EVIDENCE_DIR=...` 与 `ARCHIVE=...`：归档目录与压缩包

关键文件：

- `<SOURCE_ARTIFACT_DIR>/artifacts/summary.json`
- `<SOURCE_ARTIFACT_DIR>/screenshots/flow1-tip-button.png`
- `<SOURCE_ARTIFACT_DIR>/screenshots/flow1-tip-modal-invoice.png`
- `<SOURCE_ARTIFACT_DIR>/screenshots/flow4-author-balance-history.png`
- `<SOURCE_ARTIFACT_DIR>/screenshots/flow4-admin-withdrawal.png`
- `<SOURCE_ARTIFACT_DIR>/screenshots/flow4-explorer-withdrawal-tx.png`

## 5) 把截图移动到 Downloads

示例（把某次 run 的截图移到 Downloads）：

```bash
TS=<TIMESTAMP_OF_RUN>
TARGET="$HOME/Downloads/e2e-discourse-four-flows-$TS"

mkdir -p "$TARGET/tmp-screenshots" "$TARGET/evidence-screenshots"

mv ".tmp/e2e-discourse-four-flows/$TS/screenshots/"*.png "$TARGET/tmp-screenshots/"
mv "deploy/compose/evidence/e2e-discourse-four-flows/$TS/artifacts/screenshots/"*.png "$TARGET/evidence-screenshots/"
```

## 6) Explorer 截图若显示 `Untracked`

这通常是 explorer 视图/索引时机问题，不一定代表交易失败。可按下列方式确认：

1. 打开交易页后切换到 `Raw` 标签，再截图（会显示区块高度/确认数/Input/Output）。
2. 用 RPC 直接查交易状态（权威）：

```bash
curl -sS https://testnet.ckbapp.dev/ \
  -H 'content-type: application/json' \
  -d '{"id":1,"jsonrpc":"2.0","method":"get_transaction","params":["<TX_HASH>"]}' \
  | jq '.result.tx_status'
```

若 `status` 为 `committed`，说明链上已确认。

## 7) 单独重拍 explorer 交易截图

```bash
PW_EXPLORER_TX_HASH='<TX_HASH>' \
PW_EXPLORER_TX_URL_TEMPLATE='https://pudge.explorer.nervos.org/transaction/{txHash}' \
PW_EXPLORER_ARTIFACT_DIR='.tmp/e2e-discourse-four-flows/explorer-recheck' \
scripts/playwright-workflow-explorer-proof.sh
```

输出截图：

- `.tmp/e2e-discourse-four-flows/explorer-recheck/playwright-flow4-explorer-withdrawal-tx.png`

## 8) 提现金额与余额变化说明

默认参数是：

- `WORKFLOW_TIP_AMOUNT=31`
- `WORKFLOW_WITHDRAW_AMOUNT=61`

所以默认流程里创作者余额通常是：

- 打赏后 `62`
- 提现 `61`
- 余额剩余 `1`

这就是“链上看到转出 61，而面板余额变成 1”的原因。

如需改成其它数值，运行前导出环境变量：

```bash
export WORKFLOW_TIP_AMOUNT=31
export WORKFLOW_WITHDRAW_AMOUNT=62
```

然后再执行 capture 脚本即可。
