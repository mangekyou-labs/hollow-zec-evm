import { chainAdapters } from "chainsig.js";
import { createPublicClient, http } from "viem";
import { SIGNET_CONTRACT } from "./signet-contract";
import { config } from "../../../chains/sdk/config";

export const defaultChainEvm = new chainAdapters.evm.EVM({
  publicClient: createPublicClient({
    transport: http("https://sepolia.drpc.org"),
  }),
  contract: SIGNET_CONTRACT,
}) as any;

export function createEvmInstance(chainId: number) {
  const chainConfig = config[chainId];

  if (!chainConfig || chainConfig.type !== "evm") {
    throw new Error(`Unsupported or non-EVM chainId: ${chainId}`);
  }

  const publicClient = createPublicClient({
    transport: http(chainConfig.rpc),
  });

  return new chainAdapters.evm.EVM({
    publicClient,
    contract: SIGNET_CONTRACT,
  }) as any;
}
