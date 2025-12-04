# Zcash HTLC Integration: Execution Plan & Status

This document captures the end-to-end context of the Zcash bring-up, so the next engineer can pick up seamlessly.

---

## 1. Current Environment

| Component | Status |
| --- | --- |
| `docker-compose.zcash.yml` | Uses `electriccoinco/zcashd:latest`, direct `zcashd` entrypoint, testnet mode, RPC exposed on `localhost:18232`. Includes deprecation acknowledgement and legacy RPC flags. |
| Container `zcashd-testnet` | **Running**, RPC reachable. ✅ **Fully synced** (verificationprogress: 99.99%, initialblockdownload: complete). |
| `docker-compose.zcash-regtest.yml` | Uses `electriccoinco/zcashd:latest` in `-regtest` mode, RPC exposed on `localhost:18332`, mining enabled for local integration tests. |
| Container `zcashd-regtest` | **Running on demand** for Jest integration tests; auto-mines and self-funds HTLC flows. |
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
1. ✅ **COMPLETED**: Node sync finished (verificationprogress: 99.99%)
2. ✅ **COMPLETED**: Wallet backup verification
   - Backup file created: `/srv/zcashd/export/export20251204`
   - Deprecated methods enabled: `-allowdeprecated=getnewaddress` and `-allowdeprecated=z_getnewaddress`
   - Export directory configured: `-exportdir=/srv/zcashd/export`
   - Interactive `zcashd-wallet-tool` flow completed and recovery phrase confirmed.
3. ✅ **COMPLETED**: Address creation on testnet
   ```bash
   docker exec zcashd-testnet zcash-cli -testnet -rpcuser=zcashuser -rpcpassword=zcashpass getnewaddress
   docker exec zcashd-testnet zcash-cli -testnet -rpcuser=zcashuser -rpcpassword=zcashpass z_getnewaddress sapling
   ```

### 3.2 Integration Tests (Transparent ZEC)
4. **EVM → ZEC flow**
   - ✅ **COMPLETED on regtest**: `chains/tests/zec-integration.spec.ts` now runs an end-to-end `evm -> zec` HTLC flow against `zcashd-regtest`:
     - Creates and fills an EVM order with destination ZEC chain.
     - Resolver deploys source escrow via LOP + EscrowFactory.
     - Zcash HTLC script is built and funded on regtest; maker withdraws ZEC; resolver withdraws ETH from escrow.
   - See `README.md` → “Running the Zcash Integration Test” for exact `docker compose` and `pnpm jest` commands.
5. **ZEC → EVM flow**
   - ⏳ **PENDING**: Implement mirror integration test (`zec -> evm`) on regtest:
     - Fund ZEC HTLC on source (transparent) using `zcashd-regtest`.
     - Ensure resolver creates EVM escrow and supports refund path when needed.

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
| T1 | Finish Zcash node sync (≈3.1M blocks) | ✅ **COMPLETED** |
| T2 | Wallet backup verification + address creation | ✅ **COMPLETED** - Backup verified, addresses created on testnet |
| T3 | Transparent integration tests (EVM↔ZEC HTLC) | ⏳ **PARTIAL** - `evm→zec` passing on regtest via Jest; `zec→evm` still pending |
| T4 | Shielded z→t→HTLC→t→z flow | ⏳ Pending |
| T5 | Deploy & run smoke tests | ⏳ Pending |

*(See `TODO` list in repo for matching entries: `zec-htlc-integration-tests`, `zec-shielded-roundtrip-tests`, `zcash-deploy-smoke`.)*

---

## 5. Helpful Files

- `docker-compose.zcash.yml` – testnet container definition.
- `docker-compose.zcash-regtest.yml` – **regtest container for local testing (recommended for integration tests)**.
- `ZCASH_SETUP.md` – setup steps (Docker, Zebra, remote RPC, regtest).
- `ZCASH_REGTEST_SETUP.md` – **regtest-specific guide for local integration testing**.
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

