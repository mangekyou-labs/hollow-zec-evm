# Zcash Testing & Deployment Status

## ✅ Completed Setup

### 1. Docker Configuration
- **File**: `docker-compose.zcash.yml`
- **Purpose**: Run `zcashd` testnet in Docker container (works on macOS M4)
- **Status**: Ready to use once Docker Desktop is running

### 2. Configuration Updates
- **File**: `chains/sdk/config.ts`
- **Changes**: 
  - Added Zcash testnet entry (chainId: 199999)
  - Supports environment variable override: `ZCASH_TESTNET_RPC`
  - Uses `type: 'zcash'` (distinct from BTC)

### 3. Documentation
- **File**: `ZCASH_SETUP.md`
- **Contents**: Complete guide for:
  - Docker setup (recommended for macOS M4)
  - Zebra alternative (Rust-based node)
  - Remote RPC endpoint option
  - Block explorer API integration

### 4. Test Files
- **File**: `chains/tests/zec.spec.ts`
- **Status**: Created with unit tests for HTLC script construction
- **Note**: Requires `npm install` with `--legacy-peer-deps` to run

### 5. Shielded RPC Helpers
- **File**: `chain-abstraction-shade-agent/src/utils/zcash.ts`
- **Functions**:
  - `zSendMany()` - Send from shielded/transparent addresses
  - `waitForOperation()` - Poll for async shielded operation results

## 🚧 Next Steps (When Docker is Available)

### Step 1: Start Zcash Testnet Container
```bash
# Start Docker Desktop first, then:
docker-compose -f docker-compose.zcash.yml up -d

# Verify it's running:
docker logs zcashd-testnet

# Test RPC connection:
curl -u zcashuser:zcashpass -X POST http://localhost:18232 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"getblockchaininfo","params":[]}'
```

### Step 2: Run Unit Tests
```bash
cd chains
npm install --legacy-peer-deps
npm run test:zec
```

### Step 3: Integration Testing
1. **Start all services:**
   - Zcash Docker container (already running)
   - Shade agent: `cd chain-abstraction-shade-agent && npm run dev`
   - Frontend: `cd app && npm run dev`

2. **Test EVM → ZEC swap:**
   - Open UI at `http://localhost:3000`
   - Select EVM chain as "From"
   - Select "Zcash Testnet (ZEC)" as "To"
   - Create order and verify HTLC creation

3. **Test ZEC → EVM swap:**
   - Reverse the chains
   - Verify source-side ZEC HTLC funding works

### Step 4: Shielded Operations Testing
```bash
# Create addresses
docker exec zcashd-testnet zcash-cli -testnet getnewaddress
docker exec zcashd-testnet zcash-cli -testnet z_getnewaddress sapling

# Test z→t funding (via agent API or direct RPC)
# Test t→z sweeping after HTLC claim
```

## 📝 Key Files Reference

| File | Purpose |
|------|---------|
| `docker-compose.zcash.yml` | Docker setup for zcashd testnet |
| `ZCASH_SETUP.md` | Complete setup guide |
| `chains/sdk/zcash/index.ts` | ZEC HTLC SDK (provider, script builders) |
| `chain-abstraction-shade-agent/src/utils/zcash.ts` | Shielded RPC helpers |
| `chain-abstraction-shade-agent/src/routes/claimZec.ts` | ZEC HTLC claim endpoint |
| `chains/tests/zec.spec.ts` | Unit tests for HTLC scripts |
| `chains/sdk/config.ts` | Chain configuration (includes ZEC) |

## 🔍 How zcash-htlc-builder Works on macOS

The [zcash-htlc-builder](https://github.com/Mist-Labs/zcash-htlc-builder) project uses:
1. **Remote RPC endpoints** - Connects to `zcashd` via JSON-RPC (can be remote)
2. **Block explorer APIs** - Queries UTXOs without running full node
3. **Database persistence** - Stores HTLC state in PostgreSQL

Our implementation follows a similar pattern:
- `ZecProvider` connects to RPC (local Docker or remote)
- Can be extended to use block explorer APIs for UTXO queries
- Agent handles shielded operations via `z_sendmany` RPC

## ⚠️ Current Blockers

1. **Docker daemon not running** - Need to start Docker Desktop
2. **npm dependency conflicts** - Use `--legacy-peer-deps` flag
3. **Full node sync time** - First sync can take hours (use `-prune` for faster dev)

## 🎯 Success Criteria

- [ ] Docker container running and synced
- [ ] Unit tests passing (`npm run test:zec`)
- [ ] EVM → ZEC swap completes end-to-end
- [ ] ZEC → EVM swap completes end-to-end  
- [ ] Shielded z→t→HTLC→t→z roundtrip works
- [ ] Frontend shows Zcash in chain selector
- [ ] Agent `/api/claim-zec` endpoint functional

