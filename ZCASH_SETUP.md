# Zcash Testnet Setup for macOS M4

Since `zcashd` has limited support on macOS M4 (Apple Silicon), here are three alternative approaches to run Zcash testnet for development:

## Option 1: Docker Container (Recommended for macOS M4)

The easiest way to run Zcash testnet on macOS M4 is using Docker, which runs `zcashd` in a Linux container.

### Setup

1. **Start the Zcash testnet container:**
   ```bash
   docker-compose -f docker-compose.zcash.yml up -d
   ```

2. **Wait for sync** (this may take a while on first run):
   ```bash
   docker logs -f zcashd-testnet
   ```
   Look for messages like "Zcash version" and "Loading wallet..."

3. **Verify RPC is accessible:**
   ```bash
   curl -u zcashuser:zcashpass -X POST http://localhost:18232 \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":"1","method":"getblockchaininfo","params":[]}'
   ```

4. **Create test addresses:**
   ```bash
   # Transparent address
   docker exec zcashd-testnet zcash-cli -testnet getnewaddress
   
   # Shielded address (Sapling)
   docker exec zcashd-testnet zcash-cli -testnet z_getnewaddress sapling
   ```

5. **Fund addresses** (use Zcash testnet faucet):
   - Testnet faucet: https://testnet.zecfaucet.com
   - Or mine locally: `docker exec zcashd-testnet zcash-cli -testnet generate 101`

### Configuration

The container uses these default credentials:
- **RPC User**: `zcashuser`
- **RPC Password**: `zcashpass`
- **RPC Port**: `18232` (testnet)

Update `chains/sdk/config.ts` or set environment variable:
```bash
export ZCASH_TESTNET_RPC="http://localhost:18232"
```

### Stop Container

```bash
docker-compose -f docker-compose.zcash.yml down
```

## Option 2: Zebra (Rust-based Zcash Node)

Zebra is an alternative Zcash node implementation with better macOS support.

### Installation

```bash
# Install via Homebrew
brew install zcash/zebra/zebra

# Or build from source
cargo install --locked zebrad
```

### Run Zebra Testnet

```bash
# Start Zebra on testnet
zebrad start --network testnet

# In another terminal, use zcash-cli compatible commands
# Note: Zebra uses different RPC endpoints, check documentation
```

**Note**: Zebra's RPC interface may differ from `zcashd`. You may need to adjust `ZecProvider` to match Zebra's API.

## Option 3: Remote RPC Endpoint

If you have access to a remote Zcash testnet RPC endpoint, you can use it directly without running a local node.

### Configuration

Update `chains/sdk/config.ts`:
```typescript
199999: {
    type: 'zcash',
    name: 'Zcash Testnet',
    symbol: 'ZEC',
    unit: 'zec',
    rpc: 'https://your-remote-zcash-rpc-endpoint.com:18232',
    explorer: 'https://explorer.testnet.z.cash'
}
```

Or set environment variable:
```bash
export ZCASH_TESTNET_RPC="https://your-remote-zcash-rpc-endpoint.com:18232"
export ZCASH_RPC_USERNAME="your-username"
export ZCASH_RPC_PASSWORD="your-password"
```

### Block Explorer API Alternative

The [zcash-htlc-builder](https://github.com/Mist-Labs/zcash-htlc-builder) project supports querying UTXOs via block explorer APIs without a full node. You could extend `ZecProvider` to support this:

```typescript
// Example: Query UTXOs via block explorer API
async getUtxosFromExplorer(address: string): Promise<ZecUtxo[]> {
    const res = await axios.get(`https://explorer.testnet.z.cash/api/addr/${address}/utxo`);
    return res.data.map((utxo: any) => ({
        txid: utxo.txid,
        vout: utxo.vout,
        amount: utxo.satoshis / 1e8, // Convert satoshis to ZEC
        confirmations: utxo.confirmations
    }));
}
```

## Testing with Docker

### Option A: Testnet (Public Network)

Once Docker container is running:

1. **Run ZEC HTLC tests:**
   ```bash
   cd chains
   npm test -- zec.spec.ts
   ```

2. **Start the Shade agent with Zcash support:**
   ```bash
   cd chain-abstraction-shade-agent
   export ZCASH_RPC_URL="http://localhost:18232"
   export ZCASH_RPC_USERNAME="zcashuser"
   export ZCASH_RPC_PASSWORD="zcashpass"
   npm run dev
   ```

3. **Test shielded operations:**
   ```bash
   # Send from shielded to transparent
   docker exec zcashd-testnet zcash-cli -testnet z_sendmany \
     "ztest..." \
     '[{"address":"tm...","amount":0.1}]'
   ```

### Option B: Regtest (Local Fork - Recommended for Integration Testing)

For local integration testing without needing testnet funds, use regtest mode:

1. **Start regtest container:**
   ```bash
   docker-compose -f docker-compose.zcash-regtest.yml up -d
   ```

2. **Wait for node to start (usually ~10-15 seconds):**
   ```bash
   docker exec zcashd-regtest zcash-cli -regtest -rpcuser=zcashuser -rpcpassword=zcashpass -rpcport=18332 getblockchaininfo
   ```

3. **Create addresses and mine blocks to get funds:**
   ```bash
   # Create transparent address
   docker exec zcashd-regtest zcash-cli -regtest -rpcuser=zcashuser -rpcpassword=zcashpass -rpcport=18332 getnewaddress
   
   # Create shielded address
   docker exec zcashd-regtest zcash-cli -regtest -rpcuser=zcashuser -rpcpassword=zcashpass -rpcport=18332 z_getnewaddress sapling
   
   # Mine 101 blocks to mature coinbase (gets ~12.5 ZEC per block)
   docker exec zcashd-regtest zcash-cli -regtest -rpcuser=zcashuser -rpcpassword=zcashpass -rpcport=18332 generate 101
   
   # Check balance
   docker exec zcashd-regtest zcash-cli -regtest -rpcuser=zcashuser -rpcpassword=zcashpass -rpcport=18332 getbalance
   ```

4. **Configure SDK to use regtest:**
   ```bash
   export ZCASH_REGTEST_RPC="http://localhost:18332"
   ```
   Or update `chains/sdk/config.ts` to use chainId `199998` for regtest.

5. **Run integration tests:**
   ```bash
   cd chains
   npm test -- zec.spec.ts
   ```

**Advantages of Regtest:**
- Instant block generation (no waiting for network)
- Full control over mining and block times
- No need for testnet faucets
- Isolated from public testnet
- Perfect for CI/CD and automated testing

## Troubleshooting

### Docker container won't start
- Ensure Docker Desktop is running
- Check if port 18232 is already in use: `lsof -i :18232`
- Try removing old volumes: `docker volume rm gattaiswap_zcash-testnet-data`
- Create with new volume: `hollow_zcash-testnet-data`

### RPC connection errors
- Verify container is running: `docker ps | grep zcashd`
- Check logs: `docker logs zcashd-testnet`
- Test RPC manually with curl (see Option 1)

### Slow sync
- Zcash testnet sync can take hours. Use `-prune` flag for faster sync (but limited functionality)
- Consider using a remote RPC endpoint for faster development

## References

- [Zcash Documentation](https://zcash.readthedocs.io/)
- [Zebra Documentation](https://zebra.zfnd.org/)
- [zcash-htlc-builder](https://github.com/Mist-Labs/zcash-htlc-builder)
- [Zcash Testnet Explorer](https://explorer.testnet.z.cash)
- [Zcash Testnet Faucet](https://testnet.zecfaucet.com)

