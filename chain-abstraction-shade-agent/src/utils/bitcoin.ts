import { chainAdapters } from "chainsig.js";
import { SIGNET_CONTRACT } from "./signet-contract";

// I use testnet3, so and mempool for testnet 3 fails to get balance
// But I found blockstream works for get address and balanace, so I use it here
const btcRpcAdapter = new chainAdapters.btc.BTCRpcAdapters.Mempool(
  "https://blockstream.info/testnet/api"
);

export const Btc = new chainAdapters.btc.Bitcoin({
  network: "testnet",
  btcRpcAdapter,
  contract: SIGNET_CONTRACT,
}) as any;
