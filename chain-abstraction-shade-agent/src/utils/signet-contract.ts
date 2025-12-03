import { contracts } from "chainsig.js";

// Set up a chain signature contract instance
export const SIGNET_CONTRACT = new contracts.ChainSignatureContract({
  networkId: `testnet`,
  contractId: `v1.signer-prod.testnet`,
}) as any;
