## Bitcoin Local Setup

```
docker run --name esplora \
  -p 50001:50001 -p 8094:80 \
  --rm -i -t blockstream/esplora \
  bash -c "/srv/explorer/run.sh bitcoin-regtest explorer"
```

```
docker exec -it esplora bash
```

```
alias bitcoin-cli='/srv/explorer/bitcoin/bin/bitcoin-cli -regtest -rpccookiefile=/data/bitcoin/regtest/.cookie'
```

```
bitcoin-cli createwallet mining_address
MINING_ADDRESS=$(bitcoin-cli -rpcwallet=mining_address getnewaddress)
```

```
bitcoin-cli -rpcwallet=mining_address generatetoaddress 101 $MINING_ADDRESS
```

```
bitcoin-cli -rpcwallet=mining_address sendtoaddress bcrt1qvt45lgurdr30xk265nqg9wdkzm8n6kcmcrq4fz 1
bitcoin-cli -rpcwallet=mining_address sendtoaddress bcrt1qc8whyxx6x637j6328weljzw4clgq9sff64d4zc 1
```

## BTC Testnet Faucet

https://coinfaucet.eu/en/btc-testnet/
