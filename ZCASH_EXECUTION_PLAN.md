# Zcash HTLC Integration: Execution Plan & Status

This document captures the end-to-end context of the Zcash bring-up, so the next engineer can pick up seamlessly.

---

## 1. Current Environment

| Component | Status |
| --- | --- |
| `docker-compose.zcash.yml` | Uses `electriccoinco/zcashd:latest`, direct `zcashd` entrypoint, testnet mode, RPC exposed on `localhost:18232`. Includes deprecation acknowledgement and legacy RPC flags. |
| Container `zcashd-testnet` | **Running**, RPC reachable. Currently syncing (≈410k / 3.1M blocks, ~23% `verificationprogress`). |
| RPC credentials | `rpcuser=zcashuser`, `rpcpassword=zcashpass`. |
| `ZCASH_DOCKER_STATUS.md` | Contains full logs, troubleshooting steps, and quick commands. |

**Key verification commands**
```bash
curl -u zcashuser:zcashpass -X POST http://localhost:18232 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"getblockchaininfo","params":[]}'

docker exec zcashd-testnet zcash-cli -testnet \
  -rpcuser=zcashuser -rpcpassword=zcashpass getblockchaininfo | grep verificationprogress
```

---

## 2. Codebase Changes & Tests So Far

- **Zcash SDK (`chains/sdk/zcash`)**: HTLC script builders + RPC provider ready.
- **Shade agent**: `/api/claim-zec` route + `ZecRpc` shielded helpers implemented.
- **Frontend**: ZEC chain option wired into config (chainId `199999`).
- **Docker**: `docker-compose.zcash.yml` added for `zcashd` + documentation (`ZCASH_SETUP.md`, `ZCASH_DOCKER_STATUS.md`).
- **Unit Tests**: `chains/tests/zec.spec.ts` added and passing after ECPair + hex fixes (`npm run test:zec` succeeds).

---

## 3. Remaining Work (ordered)

### 3.1 Finish Node Sync & Wallet Prep
1. Monitor sync until `initial_block_download_complete` becomes `true`.
   - `watch -n 10 'docker exec zcashd-testnet zcash-cli ... getblockchaininfo | grep verificationprogress'`
2. Run wallet backup (required for account-based APIs):
   ```bash
   docker exec zcashd-testnet zcashd-wallet-tool backup
   ```
3. Create accounts/addresses via new APIs:
   ```bash
   docker exec zcashd-testnet zcash-cli ... z_getnewaccount
   docker exec zcashd-testnet zcash-cli ... z_getaddressforaccount <acct> sapling
   ```
   *(Alternatively, re-enable legacy `getnewaddress/z_getnewaddress` for transparent/shielded test cases.)*

### 3.2 Integration Tests (Transparent ZEC)
4. **EVM → ZEC flow**
   - Use local UI or SDK to create an EVM order with destination `199999`.
   - Ensure resolver funds ZEC HTLC via `zcashd` RPC (`sendrawtransaction`).
   - Verify `/api/claim-zec` claims HTLC using preimage; order status transitions to `withdraw_completed`.
5. **ZEC → EVM flow**
   - Fund ZEC HTLC on source (transparent) using `zcashd`.
   - Ensure resolver creates EVM escrow and claims ZEC refund path if needed.

### 3.3 Shielded Roundtrip
6. Implement `z→t→HTLC→t→z` using `ZecRpc.zSendMany` + `waitForOperation`:
   - Collect user shielded addr.
   - `zSendMany` to internal transparent HTLC funding addr.
   - After swap, `zSendMany` to user's shielded addr.

### 3.4 Deployment & Smoke Tests
7. Promote configuration variables (RPC URL/user/pass) to `.env` for agent/frontend.
8. Rebuild & deploy (`chains`, `chain-abstraction-shade-agent`, `app`).
9. Run post-deploy smoke:
   - EVM→ZEC
   - ZEC→EVM
   - (Optional) shielded roundtrip.

---

## 4. Quick Reference To-Dos

| ID | Task | Status |
| --- | --- | --- |
| T1 | Finish Zcash node sync (≈3.1M blocks) | ⏳ In Progress |
| T2 | Wallet backup + address creation (`z_getnewaccount`) | ⏳ Blocked on T1 |
| T3 | Transparent integration tests (EVM↔ZEC HTLC) | ⏳ Pending |
| T4 | Shielded z→t→HTLC→t→z flow | ⏳ Pending |
| T5 | Deploy & run smoke tests | ⏳ Pending |

*(See `TODO` list in repo for matching entries: `zec-htlc-integration-tests`, `zec-shielded-roundtrip-tests`, `zcash-deploy-smoke`.)*

---

## 5. Helpful Files

- `docker-compose.zcash.yml` – container definition.
- `ZCASH_SETUP.md` – setup steps (Docker, Zebra, remote RPC).
- `ZCASH_DOCKER_STATUS.md` – sync logs, troubleshooting, quick commands.
- `chains/tests/zec.spec.ts` – HTLC unit tests (passing).
- `chain-abstraction-shade-agent/src/utils/zcash.ts` – RPC + shielded helpers.
- `chain-abstraction-shade-agent/src/routes/claimZec.ts` – claim endpoint.

---

**Next engineer checklist**
1. Ensure `zcashd-testnet` stays running (Docker Desktop must be open).
2. Wait for sync to complete; then run wallet backup + address creation.
3. Proceed through Section 3 tasks sequentially.
4. Update `ZCASH_DOCKER_STATUS.md` as progress is made (so others can pick up).

Good luck! 🛠️

