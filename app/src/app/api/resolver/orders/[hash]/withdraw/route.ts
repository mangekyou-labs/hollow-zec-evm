import { config } from "@sdk/config";
import { Resolver } from "@sdk/evm//resolver";
import { Wallet } from "@sdk/evm//wallet";
import { JsonRpcProvider } from "ethers";
import { NextRequest, NextResponse } from "next/server";
import * as bitcoin from "bitcoinjs-lib";
import { BtcProvider, walletFromWIF } from "@sdk/btc";
// import Sdk from "@sdk/evm/cross-chain-sdk-shims";

// const bip68 = require("bip68");

const privateKey = process.env.ETH_PRIVATE_KEY || "0x";
const btcPrivateKey = process.env.BTC_PRIVATE_KEY || "0x";

const network = bitcoin.networks.testnet;

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ hash: string }> }
) {
  const { hash } = await context.params;
  if (!hash) {
    return NextResponse.json({ error: "Missing hash" }, { status: 400 });
  }
  try {
    const {
      hashLock,
      srcChainId,
      dstChainId,
      srcEscrowAddress,
      dstEscrowAddress,
      srcImmutables,
      dstImmutables,
      secret,
      htlcScript,
    } = await req.json();

    if (
      !hashLock ||
      !srcChainId ||
      !dstChainId ||
      !srcEscrowAddress ||
      !dstEscrowAddress ||
      !srcImmutables ||
      !dstImmutables ||
      !secret
    ) {
      return NextResponse.json(
        { error: "Missing required parameters" },
        { status: 400 }
      );
    }

    const btcProvider = new BtcProvider(config[99999].rpc);
    const btcResolver = walletFromWIF(btcPrivateKey, bitcoin.networks.testnet);

    const resolver = new Resolver(
      config[srcChainId].resolver!,
      config[dstChainId].resolver!
    );

    let srcWithdrawHash = "";
    let dstWithdrawHash = "";

    console.log("Withdraw in destination chain");
    if (config[dstChainId].type === "btc") {
      console.log("Destination chain: BTC");
      console.log("BTC chaim must be done by user, skip...");
    } else {
      console.log("Destination chain: ETH");
      console.log("Withdrawing from destination escrow...");
      const dstProvider = new JsonRpcProvider(
        config[dstChainId].rpc,
        dstChainId
      );
      const dstResolverWallet = new Wallet(privateKey, dstProvider);
      const { txHash: _dstWithdrawHash } = await dstResolverWallet.send(
        resolver.withdraw("dst", dstEscrowAddress, secret, dstImmutables)
      );
      dstWithdrawHash = _dstWithdrawHash;
      console.log("Withdrawal from destination complete.");
    }

    console.log("Withdraw in source chain");
    if (config[srcChainId].type === "btc") {
      console.log("Source chain: BTC");

      if (!htlcScript) {
        throw new Error("Missing htlcScript for BTC withdrawal");
      }

      console.log("Withdrawing from BTC HTLC...");
      const htlcUtxos = await btcProvider.getUtxos(srcEscrowAddress);
      if (!htlcUtxos.length) {
        throw new Error("No UTXOs found at HTLC address.");
      }

      const htlcUtxo = htlcUtxos[0];
      const rawTxHex = await btcProvider.getRawTransactionHex(htlcUtxo.txid);
      console.log("htlcScript", htlcScript);
      console.log("secret", secret);
      const htlcScriptBuffer = Buffer.from(htlcScript, "hex");
      const secretBuffer = Buffer.from(secret.slice(2), "hex");

      const resolverPubKeyHex = btcResolver.keyPair.publicKey.toString();
      const scriptContainsResolverKey = htlcScript.includes(
        Buffer.from(resolverPubKeyHex, "hex")
      );

      // const sequenceValue = bip68.encode({
      //   seconds: Number(srcImmutables.timeLocks._srcWithdrawal),
      // });

      const psbt = new bitcoin.Psbt({ network });
      // psbt.setVersion(2);
      psbt.addInput({
        hash: htlcUtxo.txid,
        index: htlcUtxo.vout,
        nonWitnessUtxo: Buffer.from(rawTxHex, "hex"),
        redeemScript: htlcScriptBuffer,
        // sequence: sequenceValue,
      });

      const redeemFee = 1000;
      const redeemValue = htlcUtxo.value - redeemFee;
      if (redeemValue <= 0) {
        throw new Error("Not enough value to redeem HTLC after fee.");
      }

      psbt.addOutput({
        address: btcResolver.address!,
        value: redeemValue,
      });

      psbt.signInput(0, {
        publicKey: Buffer.from(btcResolver.keyPair.publicKey),
        sign: (hash) => Buffer.from(btcResolver.keyPair.sign(hash)),
      });

      psbt.finalizeInput(0, (inputIndex: number, input: any) => {
        const signature = input.partialSig[0].signature;
        const unlockingScript = bitcoin.script.compile([
          signature,
          secretBuffer,
          bitcoin.opcodes.OP_TRUE,
        ]);

        const payment = bitcoin.payments.p2sh({
          redeem: {
            input: unlockingScript,
            output: input.redeemScript,
          },
        });

        return {
          finalScriptSig: payment.input,
          finalScriptWitness: undefined,
        };
      });

      const finalTxHex = psbt.extractTransaction().toHex();
      srcWithdrawHash = await btcProvider.broadcastTx(finalTxHex);
      console.log(`BTC withdrawal complete. TxID: ${srcWithdrawHash}`);
    } else {
      console.log("Source chain: ETH");
      console.log("Withdrawing from source escrow...");
      const srcProvider = new JsonRpcProvider(
        config[srcChainId].rpc,
        srcChainId
      );
      const srcResolverWallet = new Wallet(privateKey, srcProvider);
      const { txHash: _srcWithdrawHash } = await srcResolverWallet.send(
        resolver.withdraw("src", srcEscrowAddress, secret, srcImmutables)
      );
      srcWithdrawHash = _srcWithdrawHash;
      console.log("Withdrawal from source complete.");
    }

    fetch(`${process.env.APP_URL}/api/relayer/orders/${hash}/withdraw`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        srcWithdrawHash,
        dstWithdrawHash,
      }),
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Withdraw handler error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
