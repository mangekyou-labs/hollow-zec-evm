# Zcash Docker Container Status

## ✅ Container Running Successfully

The Zcash testnet container is now running and the RPC interface is **functional**!

### Current Status

- **Container**: `zcashd-testnet` (running)
- **RPC Endpoint**: `http://localhost:18232`
- **RPC Credentials**: 
  - Username: `zcashuser`
  - Password: `zcashpass`
- **Network**: Testnet
- **Sync Status**: Syncing (currently at block 20, needs ~3.2M blocks)

### Verified Working

✅ **RPC Connection**: `getblockchaininfo` returns valid response  
✅ **JSON-RPC Interface**: Responding correctly  
✅ **Container Stability**: No restart loops after fixing entrypoint

### Known Limitations

⚠️ **Wallet Setup Required**: 
- New account-based methods require wallet backup first
- Use `zcashd-wallet-tool` to backup wallet before creating addresses
- For testing, you can use the `-allowdeprecated` flag (see below)

⚠️ **Full Sync Time**: 
- Initial sync can take hours/days depending on network speed
- For faster testing, consider using `-prune` mode (limited functionality)

### Quick Test Commands

```bash
# Test RPC connection
curl -u zcashuser:zcashpass -X POST http://localhost:18232 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"getblockchaininfo","params":[]}'

# Check sync progress
docker exec zcashd-testnet zcash-cli -testnet \
  -rpcuser=zcashuser -rpcpassword=zcashpass getblockchaininfo | grep verificationprogress

# List UTXOs (once wallet is set up)
docker exec zcashd-testnet zcash-cli -testnet \
  -rpcuser=zcashuser -rpcpassword=zcashpass listunspent
```

### Progress & Next Steps

#### Completed
- Docker container pulls and starts reliably with `electriccoinco/zcashd:latest`.
- RPC connectivity verified via `getblockchaininfo`.
- `listunspent` and other wallet RPCs are reachable (currently return *reindexing* while the node syncs).
- Deprecation flags configured to unblock legacy RPCs if we choose to enable them.
- `docker-compose.zcash.yml` changes accepted.

#### In Progress
- Node is still reindexing/syncing. **All wallet operations (address creation, UTXO queries)** will fail with `code -28` until sync completes.
- Wallet backup flow (required for new account-based APIs) has **not** yet been run; plan to use `zcashd-wallet-tool backup` once sync finishes.
- Unit/integration tests (`npm run test:zec`, E2E HTLC flows) are queued up and will run once RPC endpoints are stable and synced.

#### Next Steps for Full Testing

1. **Wait for sync** (or use `-prune` for faster dev):
   ```bash
   # Monitor sync progress
   watch -n 5 'docker exec zcashd-testnet zcash-cli -testnet -rpcuser=zcashuser -rpcpassword=zcashpass getblockchaininfo | grep verificationprogress'
   ```

2. **Set up wallet** (if needed for address creation):
   ```bash
   # Backup wallet first
   docker exec zcashd-testnet zcashd-wallet-tool backup
   
   # Then create accounts/addresses
   docker exec zcashd-testnet zcash-cli -testnet \
     -rpcuser=zcashuser -rpcpassword=zcashpass z_getnewaccount
   ```

3. **Run ZEC tests**:
   ```bash
   cd chains
   npm install --legacy-peer-deps
   npm run test:zec
   ```

### Configuration

The container is configured in `docker-compose.zcash.yml` with:
- Direct `zcashd` entrypoint (bypasses problematic entrypoint script)
- Testnet mode enabled
- RPC exposed on port 18232
- Deprecation acknowledgment flag included

### Troubleshooting

**Container keeps restarting:**
- Check logs: `docker logs zcashd-testnet`
- Verify no port conflicts: `lsof -i :18232`

**RPC not responding:**
- Wait longer for zcashd to initialize (can take 30-60 seconds)
- Check container is running: `docker ps | grep zcashd`
- Test from inside container: `docker exec zcashd-testnet zcash-cli -testnet -rpcuser=zcashuser -rpcpassword=zcashpass getblockchaininfo`

**Address creation fails:**
- Wallet needs backup first (see "Set up wallet" above)
- Or use `-allowdeprecated=getnewaddress,z_getnewaddress` flag (add to command in docker-compose)

