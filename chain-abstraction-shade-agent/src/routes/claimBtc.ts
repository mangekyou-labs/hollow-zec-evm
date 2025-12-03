import { Hono } from "hono";
import * as bitcoin from "bitcoinjs-lib";
import { SignerAsync } from "bitcoinjs-lib";
import { config } from "../../../chains/sdk/config";
import { Btc } from "../utils/bitcoin";
import { BtcProvider } from "../../../chains/sdk/btc";
import { requestSignature } from "@neardefi/shade-agent-js";
import { utils } from "chainsig.js";

const { toRSV } = utils.cryptography;
const NETWORK = bitcoin.networks.testnet;
const app = new Hono();

// --- AgentSigner Class Definition ---
// This class wraps the agent's signing logic to be compatible with bitcoinjs-lib.
class AgentSigner implements SignerAsync {
  publicKey: Buffer;
  private contractId: string;
  private derivationPath: string;

  constructor(contractId: string, derivationPath: string) {
    this.contractId = contractId;
    this.derivationPath = derivationPath;
    this.publicKey = Buffer.alloc(0); // Initialize as empty
  }

  // Initializes the signer by fetching its public key. Must be called before use.
  async init() {
    const { publicKey: pubKeyString } = await Btc.deriveAddressAndPublicKey(
      this.contractId,
      this.derivationPath
    );
    this.publicKey = Buffer.from(pubKeyString, "hex");
  }

  // Asynchronously signs a hash using the remote agent.
  async sign(hash: Buffer): Promise<Buffer> {
    const signatureResponse = await requestSignature({
      path: this.derivationPath,
      payload: hash.toString("hex"),
    });

    const rsvSignature = toRSV(signatureResponse);

    // The Fix: Tell Buffer.from() that the strings are in hex format.
    const r = Buffer.from(rsvSignature.r, "hex");
    const s = Buffer.from(rsvSignature.s, "hex");

    // This will now correctly create a 64-byte buffer (32 bytes for r + 32 bytes for s).
    return Buffer.concat([r, s]);
  }
}

// --- Hono Endpoint ---
app.post("/", async (c) => {
  try {
    const { secret, dstEscrowAddress, htlcScriptHex, amount } =
      await c.req.json();
    const contractId = process.env.NEXT_PUBLIC_contractId!;
    const btcProvider = new BtcProvider(config[99999].rpc);

    console.log("🔁 Starting BTC claim flow using AgentSigner class...");

    // ### 1. Initialize the Agent Signer ###
    const signer = new AgentSigner(contractId, "bitcoin-1");
    await signer.init(); // Fetch the public key

    // ### 2. Prepare Transaction ###
    const { address: btcAddress } = bitcoin.payments.p2wpkh({
      pubkey: signer.publicKey,
      network: NETWORK,
    });
    const psbt = new bitcoin.Psbt({ network: NETWORK });
    const htlcScript = Buffer.from(htlcScriptHex, "hex");

    psbt.addInput({
      hash: dstEscrowAddress,
      index: 0,
      nonWitnessUtxo: Buffer.from(
        await btcProvider.getRawTransactionHex(dstEscrowAddress),
        "hex"
      ),
      redeemScript: htlcScript,
      sequence: 0xfffffffe,
    });

    const redeemFee = 1000;
    const redeemValue = amount - redeemFee;
    if (redeemValue <= 0)
      throw new Error("Not enough value to redeem after the fee.");
    psbt.addOutput({ address: btcAddress!, value: redeemValue });

    // ### 3. Sign using the custom signer ###
    console.log("✍️ Signing transaction with the AgentSigner...");
    await psbt.signInputAsync(0, signer);

    // ### 4. Finalize with HTLC script ###
    psbt.finalizeInput(0, (inputIndex: any, input: any) => {
      console.log("input", input);

      const derSignature = input.partialSig[0].signature;
      const unlockingScript = bitcoin.script.compile([
        derSignature,
        Buffer.from(secret, "hex"),
        bitcoin.opcodes.OP_TRUE,
      ]);
      const payment = bitcoin.payments.p2sh({
        redeem: { input: unlockingScript, output: htlcScript },
        network: NETWORK,
      });
      return { finalScriptSig: payment.input, finalScriptWitness: undefined };
    });

    // ### 5. Broadcast ###
    const finalTxHex = psbt.extractTransaction().toHex();
    console.log("🔗 Relaying transaction to the Bitcoin network...");
    const txId = await btcProvider.broadcastTx(finalTxHex);

    console.log("✅ Agent successfully claimed BTC! Redemption TXID:", txId);
    return c.json({ txId });
  } catch (err: any) {
    console.error("❌ BTC claim failed:", err.message);
    return c.json(
      { success: false, message: err.message, stack: err.stack },
      500
    );
  }
});

export default app;
