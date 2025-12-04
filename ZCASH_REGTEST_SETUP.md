# Zcash Regtest Setup for Local Integration Testing

This guide explains how to set up a local Zcash regtest node for integration testing without needing testnet funds.

## Quick Start

1. **Start the regtest container:**
   ```bash
   docker-compose -f docker-compose.zcash-regtest.yml up -d
   ```

2. **Wait for node to initialize (~10-15 seconds), then verify:**
   ```bash
   docker exec zcashd-regtest zcash-cli -regtest -rpcuser=zcashuser -rpcpassword=zcashpass -rpcport=18332 getblockchaininfo
   ```

3. **Create addresses and mine blocks:**
   ```bash
   # Create addresses
   TRANSPARENT=$(docker exec zcashd-regtest zcash-cli -regtest -rpcuser=zcashuser -rpcpassword=zcashpass -rpcport=18332 getnewaddress)
   SHIELDED=$(docker exec zcashd-regtest zcash-cli -regtest -rpcuser=zcashuser -rpcpassword=zcashpass -rpcport=18332 z_getnewaddress sapling)
   
   echo "Transparent: $TRANSPARENT"
   echo "Shielded: $SHIELDED"
   
   # Mine 101 blocks to mature coinbase (gets ~12.5 ZEC per block = ~1262.5 ZEC total)
   docker exec zcashd-regtest zcash-cli -regtest -rpcuser=zcashuser -rpcpassword=zcashpass -rpcport=18332 generate 101
   
   # Check balance
   docker exec zcashd-regtest zcash-cli -regtest -rpcuser=zcashuser -rpcpassword=zcashpass -rpcport=18332 getbalance
   ```

## Configuration

### RPC Endpoint
- **URL**: `http://localhost:18332`
- **Username**: `zcashuser`
- **Password**: `zcashpass`
- **Chain ID**: `199998` (configured in `chains/sdk/config.ts`)

### Environment Variables

Set for the Shade agent:
```bash
export ZCASH_REGTEST_RPC="http://localhost:18332"
export ZCASH_RPC_USERNAME="zcashuser"
export ZCASH_RPC_PASSWORD="zcashpass"
```

Or update `chains/sdk/config.ts` to use chainId `199998` for regtest.

## Useful Commands

### Mining Blocks
```bash
# Mine N blocks immediately
docker exec zcashd-regtest zcash-cli -regtest -rpcuser=zcashuser -rpcpassword=zcashpass -rpcport=18332 generate 10

# Mine to a specific address
ADDRESS="tm..."
docker exec zcashd-regtest zcash-cli -regtest -rpcuser=zcashuser -rpcpassword=zcashpass -rpcport=18332 generatetoaddress 10 $ADDRESS
```

### Checking Status
```bash
# Blockchain info
docker exec zcashd-regtest zcash-cli -regtest -rpcuser=zcashuser -rpcpassword=zcashpass -rpcport=18332 getblockchaininfo

# Wallet balance
docker exec zcashd-regtest zcash-cli -regtest -rpcuser=zcashuser -rpcpassword=zcashpass -rpcport=18332 getbalance

# List unspent outputs
docker exec zcashd-regtest zcash-cli -regtest -rpcuser=zcashuser -rpcpassword=zcashpass -rpcport=18332 listunspent
```

### Sending Transactions
```bash
# Send transparent to transparent
docker exec zcashd-regtest zcash-cli -regtest -rpcuser=zcashuser -rpcpassword=zcashpass -rpcport=18332 sendtoaddress "tm..." 1.0

# Send to shielded (z_sendmany)
docker exec zcashd-regtest zcash-cli -regtest -rpcuser=zcashuser -rpcpassword=zcashpass -rpcport=18332 z_sendmany "tm..." '[{"address":"zregtest...","amount":0.5}]'
```

## Advantages of Regtest

- ✅ **Instant block generation** - No waiting for network confirmations
- ✅ **Full control** - Mine blocks on demand for testing
- ✅ **No external dependencies** - No need for testnet faucets
- ✅ **Isolated** - Completely separate from public testnet
- ✅ **CI/CD friendly** - Perfect for automated testing
- ✅ **Deterministic** - Same behavior every run

## Differences from Testnet

| Feature | Testnet | Regtest |
|---------|---------|---------|
| Network | Public testnet | Local only |
| Block time | ~75 seconds | Instant |
| Mining | Requires real work | Instant with `generate` |
| Funds | Need faucet | Mine locally |
| Sync time | Hours/days | Seconds |
| Port | 18232 | 18332 |

## Troubleshooting

**Container won't start:**
- Check if port 18332 is in use: `lsof -i :18332`
- Check logs: `docker logs zcashd-regtest`

**RPC not responding:**
- Wait a bit longer for initialization (~15-20 seconds)
- Verify container is running: `docker ps | grep zcashd-regtest`
- Test with curl:
  ```bash
  curl -u zcashuser:zcashpass -X POST http://localhost:18332 \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":"1","method":"getblockchaininfo","params":[]}'
  ```

**No funds after mining:**
- Ensure you mined at least 101 blocks to mature coinbase
- Check if addresses are in wallet: `listaddresses`
- Verify balance: `getbalance`

## Stop Container

```bash
docker-compose -f docker-compose.zcash-regtest.yml down
```

To remove all data (start fresh):
```bash
docker-compose -f docker-compose.zcash-regtest.yml down -v
```

