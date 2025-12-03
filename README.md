# Hollow

Hollow is a cross-chain swap app built on 1inch Fusion+, enabling seamless swaps across Bitcoin, Zcash (transparent HTLCs), Monad, and Etherlink. It also integrates NEAR chain signatures via the Shade Agent Framework to execute 1inch cross-chain orders in a fully chain-abstracted manner.

## Description

Fusion Unleashed. Chains Abstracted.

Hollow is driven by two core visions:

1. A Unified Atomic Swap Interface via 1inch Fusion+ Extension

Hollow extends the 1inch Fusion+ protocol to support a broader set of blockchains. For this hackathon, we successfully integrated Bitcoin, Zcash (via transparent HTLCs), Monad, and Etherlink, enabling seamless bidirectional cross-chain swaps between BTC/ZEC and EVM-compatible chains like Monad and Etherlink. This proves that Fusion+ can serve as a universal layer for trustless atomic swaps beyond traditional EVM boundaries.

2. Seamless Multi-Wallet Management in a Chain-Abstracted Context

Hollow tackles the complexity of managing multiple wallets across heterogeneous chains by enabling chain-abstracted cross-chain orders. Using NEAR chain signatures and the Shade Agent Framework, we implemented a secure Trusted Execution Environment (TEE) that acts as a solver for 1inch orders. This TEE can sign both BTC and ETH-based cross-chain orders from a single environment—non-custodially—eliminating the friction of fragmented key management across chains.

Hollow Swap is a cross-chain swap app built on 1inch Fusion+, enabling seamless swaps across Bitcoin, Zcash, Monad, and Etherlink. It also integrates NEAR chain signatures via the Shade Agent Framework to execute 1inch cross-chain orders in a fully chain-abstracted manner.

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

## Partner Integration

### 1inch Fusion + Extension and Building Full Application

I added support for BTC, Monad, and Etherlink. The swap functionality is bidirectional and includes a UI with detailed status displays. I also implemented NEAR’s Shade Agent with chain signatures to sign BTC and ETH cross-chain orders within a TEE environment, demonstrating the potential for chain abstraction.

I primarily used a cross-chain swap SDK and existing smart contracts, making our implementation easily integrable with the 1inch protocol in the future. We closely studied the whitepaper and aimed to align our flow with 1inch Fusion and the existing architecture.

#### The Main implementations are followings.

##### Deploy Script

https://github.com/taijusanagi/2025-unite/blob/main/chains/script/evm/Deploy.s.sol

##### BTC SDK includes HTCL Script

https://github.com/taijusanagi/2025-unite/blob/main/chains/sdk/btc/index.ts#L179

##### Local Swap Test for BTC <> ETH

https://github.com/taijusanagi/2025-unite/blob/main/chains/tests/btc.spec.ts

##### UI - CreateOrder

https://github.com/taijusanagi/2025-unite/blob/main/app/src/app/page.tsx#L169

##### Resolver - Create Escrow

https://github.com/taijusanagi/2025-unite/blob/main/app/src/app/api/resolver/orders/%5Bhash%5D/escrow/route.ts

##### Resoler - Withdraw

https://github.com/taijusanagi/2025-unite/blob/main/app/src/app/api/resolver/orders/%5Bhash%5D/withdraw/route.ts

### NEAR - 1inch Fusion+ Solver Built with NEAR's Shade Agent Framework

I integrated the 1inch Fusion+ Solver, built using NEAR’s Shade Agent Framework, into our application. The app supports cross-chain swaps between BTC and ETH, with unified wallet management enabled by NEAR’s chain signature, which supports both ETH and BTC order signing.

The solver takes trade intents—including makerAsset, takerAsset, and amount—then the agent constructs a 1inch cross-chain order, signed using NEAR’s chain signature.

I believe this architecture lays the foundation for true chain abstraction.

To setup the environment for the demo, please follow this steps.

https://github.com/taijusanagi/2025-unite/tree/main/chain-abstraction-shade-agent

Then you can use http://localhost:8080 in connect Hollow Wallet section.

![Hollow](./app/public/Hollow.png)

### Etherlink

I deployed 1inch protocol's Limit Order Protocol, Escrow Factory, Resolver, and TrueERC20 contracts to enable cross-chain swaps with Etherlink. These contracts and the associated SDK were originally built for mainnet, so I modified the supported chains and hash mechanisms to ensure compatibility with Etherlink.

Additionally, I tested a cross-chain swap between Etherlink and BTC, demonstrating the potential for integrating cross-chain swap functionality within Etherlink.

### Deployments

## Monad

Limit Order Protocol
https://testnet.monadexplorer.com/address/0x3c63B9da5DA101F36061C9503a06906031D7457c

Escrow Factory
https://testnet.monadexplorer.com/address/0x73e5d195b5cf7eb46de86901ad941986e74921ca

Resolver
https://testnet.monadexplorer.com/address/0xF920618C3CF765cE5570A15665C50b3e3f287352

TrueERC20
https://testnet.monadexplorer.com/address/0xf927004F33f26CaA1763BB21454Ef36AA76e1064

## Etherlink

Limit Order Protocol
https://testnet.explorer.etherlink.com/address/0x64BE4a6b41A5910b56e26c587454cDc023614e92

Escrow Factory
https://testnet.explorer.etherlink.com/address/0x7c054c1081F747cbC39Aa4899A53378eA66b3Dea

Resolver
https://testnet.explorer.etherlink.com/address/0xF920618C3CF765cE5570A15665C50b3e3f287352

TrueERC20
https://testnet.explorer.etherlink.com/address/0x436b7B4d6cBe36A8cE531b5C5DAa3Eb369035EF4
