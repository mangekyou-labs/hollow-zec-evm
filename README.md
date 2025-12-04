# Hollow

Hollow is a cross-chain swap app built on 1inch Fusion+, enabling seamless swaps across Bitcoin, Zcash (transparent HTLCs), Monad, and Etherlink. It also integrates NEAR chain signatures via the Shade Agent Framework to execute 1inch cross-chain orders in a fully chain-abstracted manner.

## Description

Fusion Unleashed. Chains Abstracted.

Hollow is driven by two core visions:

1. A Unified Atomic Swap Interface via 1inch Fusion+ Extension

Hollow extends the 1inch Fusion+ protocol to support a broader set of blockchains. For this hackathon, we successfully integrated Bitcoin, Zcash (via transparent HTLCs), Monad, and Etherlink, enabling seamless bidirectional cross-chain swaps between BTC/ZEC and EVM-compatible chains like Monad and Etherlink. This proves that Fusion+ can serve as a universal layer for trustless atomic swaps beyond traditional EVM boundaries.



## How it's made

🔁 1. Atomic Swap Mechanism Using Bitcoin & Zcash HTLCs

Hollow utilizes Hash Time-Locked Contracts (HTLCs) on Bitcoin and Zcash’s transparent layer to achieve atomicity in cross-chain swaps. It leverages the 1inch cross-chain SDK and existing 1inch smart contracts deployed on both EVM chains and UTXO chains (via script-based logic).

🔹 When the Maker Asset is BTC:

A hashed lock script is generated on the Bitcoin side using the timelock and hash preimage from the 1inch cross-chain order.

The user (maker) signs a funding transaction locking BTC into the HTLC — but does not broadcast it.

The signed transaction and order data are passed to a relayer.

The relayer signals resolvers, and the resolver broadcasts the signed transaction, officially locking the maker's BTC.

Using the mined transaction details, the resolver creates an escrow on the destination chain, completing the bidirectional swap setup.

⏱ Note: The Bitcoin HTLC uses relative time checks, since the timelock begins once the btc transaction is confirmed.

🔹 When the Taker Asset is BTC:

The maker creates a 1inch cross-chain swap order.

The resolver sets up a hashed lock address on Bitcoin to serve as escrow.

⏱ Note: The Bitcoin HTLC uses absolute time checks, since the timelock begins once the eth transaction is confirmed.

🔐 2. Chain-Abstraction via NEAR Signatures & Shade Agent Framework

Hollow solves multi-wallet complexity through chain abstraction:

When a user initiates a swap via Hollow, it interacts with a chain signature contract on NEAR to derive a usable address and sign messages. The Shade Agent Framework is employed to generate and sign 1inch cross-chain orders from a Trusted Execution Environment (TEE). The shade agent uses the request_signature functionality to securely sign both BTC and ETH-based orders—without compromising custodial control.

💻 3. Integration of EVM-Compatible Chains

We also support Etherlink and Monad, with bidirectional swaps with BTC successfully tested.

## Limitation

- Bitcoin script can set timestamp or block height (relative/absolute) to ensure the transaction occurs after the specified timing. But it cannot enforce an upper time limit.

- Bitcoin script can define who is allowed to spend the transaction but cannot enforce a specific recipient. So relayer cannot withdraw on behalf of the user or perform public withdrawals and cancellations.

- On-chain Dutch Auction or Partial Fill is not feasible. It may require off-chain coordination or would break the current 1inch Fusion + Flow model.

## Running the Zcash Integration Test

Use the following steps to reproduce the `evm -> zec` HTLC flow end-to-end:

1. **Start the regtest node**
   ```bash
   docker compose -f docker-compose.zcash-regtest.yml up -d
   ```
2. **Install dependencies** (one time)
   ```bash
   cd chains
   pnpm install
   ```
3. **Run the Jest suite with an extended timeout**
   ```bash
   pnpm jest tests/zec-integration.spec.ts --runInBand --testTimeout=300000
   ```

   The script mines and funds the Zcash node automatically. You will see logs for each phase (order creation, resolver fill, HTLC funding, withdrawals). The test exits green when the workflow succeeds.

> If you stop the regtest node, rerun step 1 before executing the suite again.