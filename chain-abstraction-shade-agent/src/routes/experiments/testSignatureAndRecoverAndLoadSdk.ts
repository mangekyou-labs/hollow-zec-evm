import { Hono } from "hono";
import { ethers } from "ethers";
import * as secp256k1 from "@bitcoinerlab/secp256k1";
import * as bitcoin from "bitcoinjs-lib";

import { nativeTokenAddress } from "../../../../chains/sdk/evm/constants";
import { requestSignature } from "@neardefi/shade-agent-js";

const app = new Hono();

app.get("/", async (c) => {
  try {
    const payloadHex =
      "ab09b204305ba1b8c546a90fab8098263337098e37011471c0699e784a16ba97";

    // --- ETHEREUM ---
    const ethSignRes = await requestSignature({
      path: "ethereum-1",
      payload: payloadHex,
    });

    const r = ethSignRes.big_r.affine_point.slice(2); // drop '03' compressed prefix
    const s = ethSignRes.s.scalar.replace(/^0x/, "").padStart(64, "0");
    const v = ethSignRes.recovery_id + 27;

    const signature = `0x${r}${s}${v.toString(16).padStart(2, "0")}`;
    const ethAddress = ethers.recoverAddress(`0x${payloadHex}`, signature);

    // // --- BITCOIN ---
    const btcSignRes = await requestSignature({
      path: "bitcoin-1",
      payload: payloadHex,
    });

    const msgHash = Buffer.from(payloadHex, "hex");

    const rBuf = Buffer.from(btcSignRes.big_r.affine_point, "hex"); // compressed pubkey
    const sBuf = Buffer.from(btcSignRes.s.scalar.padStart(64, "0"), "hex");
    const recoveryId = btcSignRes.recovery_id;

    // Create compact signature: 64-byte (r + s)
    const compactSig = Buffer.concat([rBuf.slice(1), sBuf]); // remove '03' from compressed r

    // Recover public key

    const pubkey = secp256k1.recover(msgHash, compactSig, recoveryId, true);
    if (!pubkey) throw new Error("Bitcoin public key recovery failed");

    // Generate P2PKH Bitcoin address (mainnet)
    const { address: btcAddress } = bitcoin.payments.p2wpkh({
      pubkey: Buffer.from(pubkey),
      network: bitcoin.networks.testnet,
    });

    return c.json({
      success: true,
      ethereumAddress: ethAddress,
      bitcoinAddress: btcAddress,
      nativeTokenAddress,
    });
  } catch (error) {
    console.error("Error recovering addresses:", error);
    return c.json({ error: "Failed to recover addresses: " + error }, 500);
  }
});

export default app;
