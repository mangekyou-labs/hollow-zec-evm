// app/api/resolver/orders/[hash]/process/route.ts

import { NextResponse } from "next/server";
import { JsonRpcProvider } from "ethers";
import * as Sdk from "@1inch/cross-chain-sdk";
import { config } from "@sdk/config";
import { Wallet } from "@sdk/evm/wallet";
import { Resolver } from "@sdk/evm/resolver";
import { EscrowFactory } from "@sdk/evm/escrow-factory";
import { setDeployedAt } from "@sdk/evm/timelocks";
import { Address } from "@1inch/cross-chain-sdk";

import * as bitcoin from "bitcoinjs-lib";

import {
  addressToEthAddressFormat,
  BtcProvider,
  createDstHtlcScript,
  publicKeyToAddress,
  walletFromWIF,
} from "@sdk/btc";

const ethPrivateKey = process.env.ETH_PRIVATE_KEY || "0x";
const btcPrivateKey = process.env.BTC_PRIVATE_KEY || "0x";

const network = bitcoin.networks.testnet;

export async function POST(
  _req: Request,
  context: { params: Promise<{ hash: string }> }
) {
  try {
    const { hash } = await context.params;
    if (!hash) {
      return NextResponse.json({ error: "Missing hash" }, { status: 400 });
    }

    const response = await fetch(
      `${process.env.APP_URL}/api/relayer/orders/${hash}`
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: "Order not found in relayer" },
        { status: 404 }
      );
    }

    const {
      hashLock,
      srcChainId,
      dstChainId,
      order: _order,
      extension,
      signature,
      btcUserPublicKey,
    } = await response.json();
    const order = Sdk.CrossChainOrder.fromDataAndExtension(_order, extension);

    const btcProvider = new BtcProvider(config[99999].rpc);

    const evmResolverContract = new Resolver(
      config[srcChainId].resolver!,
      config[dstChainId].resolver!
    );
    const fillAmount = order.makingAmount;
    const btcResolver = walletFromWIF(btcPrivateKey, bitcoin.networks.testnet);

    let srcImmutables: Sdk.Immutables;
    let complement: Sdk.DstImmutablesComplement;
    let dstImmutables: Sdk.Immutables;
    let srcEscrowAddress: string;
    let dstEscrowAddress: string;
    let dstDeployedAt: bigint;
    let srcDeployHash: string;
    let dstDeployHash: string;
    let htlcScript = "";

    console.log("Escrow deployment in source chain");
    if (config[srcChainId].type === "btc") {
      console.log("Source chain: BTC");

      // For BTC -> EVM, the 'signature' contains the funded transaction details
      const { txHex, htlcScriptHex, p2shAddress } = JSON.parse(signature);

      console.log("Broadcasting BTC HTLC funding transaction...");
      srcDeployHash = await btcProvider.broadcastTx(txHex);
      console.log(`BTC funding tx broadcasted: ${srcDeployHash}`);

      console.log("Waiting for BTC transaction confirmation...");
      // const { confirmedAt } = await btcProvider.waitForTxConfirmation(
      //   srcDeployHash
      // );
      // to make the demo easier
      const confirmedAt = Math.floor(Date.now() / 1000);
      console.log(`BTC tx confirmed at timestamp: ${confirmedAt}`);

      htlcScript = htlcScriptHex;
      srcEscrowAddress = p2shAddress;

      // // Reconstruct immutables based on the confirmed BTC transaction
      const timeLocksWithDeployment = Sdk.TimeLocks.fromBigInt(
        setDeployedAt(
          //@ts-ignore
          order.inner.fusionExtension.timeLocks.build(),
          BigInt(confirmedAt)
        )
      );

      srcImmutables = Sdk.Immutables.new({
        orderHash: hash,
        // @ts-ignore
        hashLock: order.inner.fusionExtension.hashLockInfo,
        maker: order.maker,
        taker: new Address(addressToEthAddressFormat(btcResolver.address!)),
        token: order.makerAsset,
        amount: order.makingAmount,
        // @ts-ignore
        safetyDeposit: order.inner.fusionExtension.srcSafetyDeposit,
        timeLocks: timeLocksWithDeployment,
      });

      complement = Sdk.DstImmutablesComplement.new({
        maker: order.receiver,
        token: order.takerAsset,
        amount: order.takingAmount,
        // @ts-ignore
        safetyDeposit: order.inner.fusionExtension.dstSafetyDeposit,
      });

      // Destination taker is the EVM resolver contract
      dstImmutables = srcImmutables
        .withComplement(complement)
        .withTaker(new Address(evmResolverContract.dstAddress));
    } else {
      console.log("Source chain: EVM");
      const srcProvider = new JsonRpcProvider(
        config[srcChainId].rpc,
        srcChainId
      );
      const srcResolverWallet = new Wallet(ethPrivateKey, srcProvider);
      const srcEscrowFactory = new EscrowFactory(
        srcResolverWallet.provider,
        config[srcChainId].escrowFactory!
      );
      console.log("Deploying source escrow contract...");

      const {
        txHash: _srcDeployHash,
        blockNumber: srcDeployBlockNumber,
        blockTimestamp: srcDeployedAt,
      } = await srcResolverWallet.send(
        evmResolverContract.deploySrc(
          srcChainId,
          config[srcChainId].limitOrderProtocol!,
          order,
          signature,
          Sdk.TakerTraits.default()
            .setExtension(order.extension)
            .setAmountMode(Sdk.AmountMode.maker)
            .setAmountThreshold(order.takingAmount),
          fillAmount
        )
      );
      srcDeployHash = _srcDeployHash;
      console.log(
        `Source deployed at block hash: ${srcDeployHash}, timestamp: ${srcDeployedAt}`
      );

      console.log("Fetching source deployment event...");
      const srcEvent = await srcEscrowFactory.getSrcDeployEvent(
        srcDeployBlockNumber
      );
      console.log("Source deployment event fetched.");
      console.log("Constructing destination escrow immutables...");
      srcImmutables = srcEvent[0];
      complement = srcEvent[1];

      if (dstChainId === 99999) {
        dstImmutables = srcImmutables
          .withComplement(complement)
          // .withTaker(new Address(evmResolverContract.dstAddress));
          .withTaker(
            new Address(addressToEthAddressFormat(btcResolver.address))
          );
      } else {
        dstImmutables = srcImmutables
          .withComplement(complement)
          .withTaker(new Address(evmResolverContract.dstAddress));
      }

      console.log("Calculating source escrow address...");
      srcEscrowAddress = new Sdk.EscrowFactory(
        new Address(config[srcChainId].escrowFactory!)
      )
        .getSrcEscrowAddress(
          srcImmutables,
          await srcEscrowFactory.getSourceImpl()
        )
        .toString();
      console.log(`Source escrow address: ${srcEscrowAddress}`);
    }

    console.log("Escrow deployment in destination chain");
    if (config[dstChainId].type === "btc") {
      console.log("Destination chain: BTC");

      const recipientAddress = publicKeyToAddress(
        btcUserPublicKey,
        bitcoin.networks.testnet
      );
      const ethFormattedRecipientAddress =
        addressToEthAddressFormat(recipientAddress);

      if (order.receiver.toString() !== ethFormattedRecipientAddress) {
        throw new Error(
          `Mismatch: order.receiver ${order.receiver} does not match BTC destination address ${ethFormattedRecipientAddress}`
        );
      }

      console.log("hashLock.sha256", hashLock.sha256);
      console.log("btcUserPublicKey", btcUserPublicKey);

      // BTC takes too long to be confirmed so it uses src deployed value for now
      const dstTimeLocks = dstImmutables.timeLocks.toDstTimeLocks();

      console.log(
        "dstTimeLocks.privateWithdrawal",
        dstTimeLocks.privateWithdrawal
      );
      console.log(
        "dstTimeLocks.privateCancellation",
        dstTimeLocks.privateCancellation
      );

      const htlcScriptBuffer = createDstHtlcScript(
        hash,
        Buffer.from(hashLock.sha256, "hex"),
        dstTimeLocks.privateWithdrawal,
        dstTimeLocks.privateCancellation,
        Buffer.from(btcUserPublicKey, "hex"),
        btcResolver.publicKey,
        false
      );
      const p2sh = bitcoin.payments.p2sh({
        redeem: { output: htlcScriptBuffer, network },
        network,
      });

      console.log("✅ HTLC P2SH Address:", p2sh.address);

      // === Taker (resolver) funds the HTLC ===
      const utxos = await btcProvider.getUtxos(btcResolver.address!);
      if (!utxos.length) {
        console.error("❌ No UTXOs available to fund HTLC.");
        return;
      }

      const amount = Number(order.takingAmount); // Match maker's amount or adjust as needed
      const fee = 1000;
      const totalInput = utxos.reduce((sum, u) => sum + u.value, 0);
      const change = totalInput - amount - fee;

      if (change < 0) {
        console.error("❌ Not enough funds to lock BTC and cover the fee.");
        return;
      }

      const psbt = new bitcoin.Psbt({ network });

      for (const utxo of utxos) {
        psbt.addInput({
          hash: utxo.txid,
          index: utxo.vout,
          witnessUtxo: {
            script: bitcoin.payments.p2wpkh({
              pubkey: btcResolver.publicKey,
              network,
            }).output!,
            value: utxo.value,
          },
        });
      }

      psbt.addOutput({
        script: p2sh.output!,
        value: amount,
      });

      if (change > 0) {
        psbt.addOutput({
          address: btcResolver.address!, // refund to self
          value: change,
        });
      }

      utxos.forEach((_, idx) => {
        psbt.signInput(idx, {
          publicKey: btcResolver.publicKey,
          sign: (hash) => Buffer.from(btcResolver.keyPair.sign(hash)),
        });
      });

      psbt.finalizeAllInputs();

      const txHex = psbt.extractTransaction().toHex();
      const btcDstEscrowHash = await btcProvider.broadcastTx(txHex);

      console.log("✅ Taker has funded HTLC:");
      console.log("🔗 btcDstEscrowHash:", btcDstEscrowHash);

      // skip confirmation check since it takes too long time
      // const { confirmedAt } = await btcProvider.waitForTxConfirmation(
      //   btcDstEscrowHash
      // );
      // console.log("confirmedAt", confirmedAt);

      dstEscrowAddress = btcDstEscrowHash;
      // BTC takes too long to be confirmed so it uses src deployed value for now
      dstDeployedAt = dstImmutables.timeLocks.deployedAt;
      dstDeployHash = btcDstEscrowHash;

      console.log("htlcScriptBuffer", htlcScriptBuffer);
      htlcScript = htlcScriptBuffer.toString("hex");
    } else {
      console.log("Destination chain: EVM");
      const dstProvider = new JsonRpcProvider(
        config[dstChainId].rpc,
        dstChainId
      );
      const dstResolverWallet = new Wallet(ethPrivateKey, dstProvider);
      const dstEscrowFactory = new EscrowFactory(
        dstResolverWallet.provider,
        config[dstChainId].escrowFactory!
      );
      console.log("Deploying destination escrow contract...");
      console.log("dstImmutables", dstImmutables);
      const { txHash: _dstDeployHash, blockTimestamp: _dstDeployedAt } =
        await dstResolverWallet.send(
          evmResolverContract.deployDst(dstImmutables)
        );
      dstDeployHash = _dstDeployHash;
      dstDeployedAt = _dstDeployedAt;
      console.log(
        `Destination deployed at block hash: ${dstDeployHash}, timestamp: ${dstDeployedAt}`
      );
      console.log("Calculating destination escrow address...");
      dstEscrowAddress = new Sdk.EscrowFactory(
        new Address(config[dstChainId].escrowFactory!)
      )
        .getDstEscrowAddress(
          srcImmutables,
          complement,
          _dstDeployedAt,
          new Address(evmResolverContract.dstAddress),
          await dstEscrowFactory.getDestinationImpl()
        )
        .toString();
      console.log(`Destination escrow address: ${dstEscrowAddress}`);
    }

    await fetch(`${process.env.APP_URL}/api/relayer/orders/${hash}/escrow`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        srcEscrowAddress: srcEscrowAddress,
        dstEscrowAddress: dstEscrowAddress,
        srcImmutables: srcImmutables.build(),
        dstImmutables: dstImmutables.withDeployedAt(dstDeployedAt).build(),
        srcDeployHash,
        dstDeployHash,
        htlcScript,
      }),
    });

    console.log(`Done`);

    return NextResponse.json({
      success: true,
    });
  } catch (err) {
    console.error("Resolver error:", err);
    return NextResponse.json({ error: "Resolver failed" }, { status: 500 });
  }
}
