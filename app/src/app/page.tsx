"use client";
import React, { useEffect, useState } from "react";
import { FaGithub } from "react-icons/fa";
import { ConnectButton, useConnectModal } from "@rainbow-me/rainbowkit";
import { uint8ArrayToHex, UINT_256_MAX, UINT_40_MAX } from "@1inch/byte-utils";
import { randomBytes } from "crypto";
import { Contract } from "ethers";
import { useEthersSigner } from "@/hooks/useEthersSigner";
import { useAccount, useChainId } from "wagmi";

import { config } from "@sdk/config";
import StatusModal, { Status, StatusState } from "@/components/StatusModal";
import ConnectModal from "@/components/ConnectModal";
import BtcConnectModal from "@/components/BtcConnectModal";
import BtcAccountModal from "@/components/BtcAccountModal";
import ConnectGattaiModal from "@/components/ConnectGattaiModal";
import GattaiWalletAccountModal from "@/components/GattaiWalletAccountModal"; // Import the new modal

import Sdk from "@sdk/evm/cross-chain-sdk-shims";
import {
  dummySrcChainId,
  dummyDstChainId,
  nativeTokenAddress,
  nullAddress,
} from "@sdk/evm/constants";
import { patchedDomain, getOrderHashWithPatch } from "@sdk/evm/patch";
import IWETHContract from "@sdk/evm/contracts/IWETH.json";

import {
  addressToEthAddressFormat,
  BtcProvider,
  createSrcHtlcScript,
} from "@sdk/btc";

import * as bitcoin from "bitcoinjs-lib";
import { walletFromWIF, BtcWallet } from "@sdk/btc";

const network = bitcoin.networks.testnet;

const { Address } = Sdk;
const btcResolverPublicKey =
  process.env.NEXT_PUBLIC_BTC_RESOLVER_PUBLIC_KEY || "";

export default function Home() {
  const [showDex, setShowDex] = useState(false);
  const { openConnectModal } = useConnectModal();
  const coins = ["/coins/btc.png", "/coins/monad.png", "coins/etherlink.png"];
  const chains = Object.entries(config).map(([chainId, cfg]) => ({
    chainId: Number(chainId),
    type: cfg.type,
    name: cfg.name,
    symbol: cfg.symbol,
    unit: cfg.unit,
    exproler: cfg.explorer,
  }));

  const [fromChain, setFromChain] = useState(chains[0]);
  const [toChain, setToChain] = useState(chains[3]);
  const [amount] = useState(5000);

  const evmSigner = useEthersSigner();
  const connectedChainId = useChainId();
  const { address: evmConnectedAddress } = useAccount();

  const [btcUser, setBtcUser] = useState<BtcWallet | null>(null);

  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [isBtcConnectModalOpen, setIsBtcConnectModalOpen] = useState(false);
  const [isBtcAccountModalOpen, setIsBtcAccountModalOpen] = useState(false);
  const [isGattaiConnectModalOpen, setIsGattaiConnectModalOpen] =
    useState(false);
  const [isGattaiAccountModalOpen, setIsGattaiAccountModalOpen] =
    useState(false); // State for the new modal

  const [gattaiAgentUrl, setGattaiAgentUrl] = useState<string | null>(null);
  const [gattaiWalletConfig, setGattaiWalletConfig] = useState<any | null>(
    null
  );

  const [statuses, setStatuses] = useState<Status[]>([]);

  const [isSwapping, setIsSwapping] = useState(false);

  useEffect(() => {
    const savedKey = localStorage.getItem("btcPrivateKey");
    if (savedKey) {
      try {
        const network = bitcoin.networks.testnet;
        const wallet = walletFromWIF(savedKey, network);
        setBtcUser(wallet);
      } catch (error) {
        console.error("Failed to load/validate BTC private key:", error);
        localStorage.removeItem("btcPrivateKey");
        setBtcUser(null);
      }
    }
  }, []);

  useEffect(() => {
    const evmConnected = !!evmSigner;
    const btcConnected = !!btcUser;
    const gattaiConnected = !!gattaiWalletConfig;

    // Close ConnectModal if both EVM and BTC wallets are connected, or Gattai is connected
    if ((evmConnected && btcConnected) || gattaiConnected) {
      setIsConnectModalOpen(false);
    }
  }, [evmSigner, btcUser, gattaiWalletConfig]);

  const evmConnectWallet = () => {
    if (openConnectModal) {
      openConnectModal();
    }
  };

  const btcConnectWallet = () => {
    setIsBtcConnectModalOpen(true);
  };

  const onConnectGattai = () => {
    setIsGattaiConnectModalOpen(true);
  };

  const handleBtcConnect = (privateKey: string) => {
    try {
      const network = bitcoin.networks.testnet;
      const wallet = walletFromWIF(privateKey, network);
      localStorage.setItem("btcPrivateKey", privateKey);
      setBtcUser(wallet);
      setIsBtcConnectModalOpen(false);
    } catch (e) {
      console.error(e);
      alert(
        "Invalid Bitcoin Testnet private key (WIF format). Please check and try again."
      );
      localStorage.removeItem("btcPrivateKey");
      setBtcUser(null);
    }
  };

  const handleGattaiConnect = async (url: string) => {
    try {
      const response = await fetch(`${url}/api/account`);
      if (!response.ok) throw new Error("Failed to fetch Gattai wallet config");
      const data = await response.json();

      setGattaiWalletConfig({
        accountId: data.accountId,
        evmAddress: data.evmAddress,
        btcAddress: data.btcAddress,
        btcPublicKey: data.btcPublicKey,
      });
      setGattaiAgentUrl(url);
      setIsGattaiConnectModalOpen(false);
    } catch (error) {
      console.error("Error connecting Hollow wallet:", error);
      alert("Failed to connect to Hollow Wallet. Please check the URL.");
    }
  };

  // Handler to disconnect from Gattai Wallet
  const handleGattaiDisconnect = () => {
    setGattaiWalletConfig(null);
    setGattaiAgentUrl(null);
    setIsGattaiAccountModalOpen(false);
  };

  const createOrder = async () => {
    console.log("🔄 Starting order creation...");

    if (!btcResolverPublicKey) {
      console.warn("⚠️ btc resolver public key not defined.");
      alert("btc resolver public key not defined.");
      setIsStatusModalOpen(false);
      return;
    }

    if (fromChain.chainId === toChain.chainId) {
      console.warn("⚠️ Source and destination networks are the same.");
      alert("The source and destination networks must be different.");
      setIsStatusModalOpen(false);
      return;
    }

    console.log("conneced evm address", evmSigner?.address);
    console.log("conneced btc address", btcUser?.address);

    console.log("✅ All pre-checks passed.");
    setIsStatusModalOpen(true);
    let currentStatuses: Status[] = [];

    const addStatus = (text: string) => {
      console.log(`📌 Status: ${text}`);
      currentStatuses = [...currentStatuses, { text, state: "loading" }];
      setStatuses(currentStatuses);
    };

    const updateLastStatus = (state: StatusState, explorers?: any[]) => {
      const last = currentStatuses[currentStatuses.length - 1];
      console.log(`✅ Updated last status to '${state}':`, last?.text);
      currentStatuses = [
        ...currentStatuses.slice(0, -1),
        { ...last, state, explorers },
      ];
      setStatuses(currentStatuses);
    };

    const addFinalStatus = (text: string, state: StatusState) => {
      console.log(`🏁 Final Status (${state}): ${text}`);
      currentStatuses = [...currentStatuses, { text, state }];
      setStatuses(currentStatuses);
    };

    const srcChainId = fromChain.chainId;
    const dstChainId = toChain.chainId;

    let makerAsset = new Address(nullAddress);
    if (config[srcChainId].type === "evm") {
      makerAsset = new Address(config[srcChainId].wrappedNative!);
    }

    let takerAsset = new Address(nativeTokenAddress);
    if (config[dstChainId].type === "evm") {
      takerAsset = new Address(config[dstChainId].wrappedNative!);
    }

    try {
      console.log("🚧 Order preparation started...");
      setStatuses([]);

      const btcProvider = new BtcProvider(config[99999].rpc);

      let secret,
        hashLock,
        order,
        extension,
        orderHash,
        signature,
        btcUserPublicKey;

      if (gattaiWalletConfig) {
        addStatus(
          "Creating 1inch Fusion+ Order in Gattai Solver Built with NEAR's Shade Agent"
        );
        const res = await fetch(
          `${gattaiAgentUrl}/api/create-order-by-intent`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              srcChainId,
              dstChainId,
              makerAsset: makerAsset.val,
              takerAsset: takerAsset.val,
              amount,
            }),
          }
        );

        if (!res.ok) {
          throw new Error("Failed to create order via Gattai Wallet");
        }

        const data = await res.json();

        console.log("response from hollow wallet: ", data);

        secret = Buffer.from(data.secret, "hex");
        hashLock = data.hashLock;
        order = data.order;
        orderHash = data.hash;
        signature = data.signature;

        extension = data.extension;
        btcUserPublicKey = data.btcUserPublicKey;

        updateLastStatus("done");
      } else {
        if (fromChain.type === "evm" && !evmSigner) {
          console.warn("⚠️ EVM signer not connected.");
          alert("Please connect your EVM wallet to place an order.");
          evmConnectWallet();
          setIsStatusModalOpen(false);
          return;
        }

        if (
          fromChain.type === "evm" &&
          connectedChainId !== fromChain.chainId
        ) {
          console.warn("⚠️ Wrong EVM chain selected.");
          alert("Please switch to the 'From' network in your wallet.");
          setIsStatusModalOpen(false);
          return;
        }

        if (fromChain.type === "btc" && !btcUser) {
          console.warn("⚠️ BTC user not connected for source chain.");
          alert("Please connect your BTC wallet to place an order.");
          setIsStatusModalOpen(false);
          btcConnectWallet();
          return;
        }

        if (toChain.type === "btc" && !btcUser) {
          console.warn("⚠️ BTC user not connected for destination chain.");
          alert("Please connect your BTC wallet when destination is BTC.");
          btcConnectWallet();
          setIsStatusModalOpen(false);
          return;
        }

        if (config[srcChainId].type === "evm") {
          const srcWrappedNativeTokenContract = new Contract(
            config[srcChainId].wrappedNative!,
            IWETHContract.abi,
            evmSigner!
          );

          addStatus("Checking user's wrapped native token balance");
          const balance = await srcWrappedNativeTokenContract.balanceOf(
            evmSigner!.address
          );
          console.log("💰 Token balance:", balance.toString());
          updateLastStatus("done");

          if (balance < amount) {
            addStatus("Depositing wrapped native token");
            const tx = await srcWrappedNativeTokenContract.deposit({
              value: amount,
            });
            console.log("📤 Deposit TX:", tx.hash);
            await tx.wait();
            updateLastStatus("done", [
              {
                explorerUrl: `${fromChain.exproler}/tx/${tx.hash}`,
                network: fromChain.name,
              },
            ]);
          }

          addStatus("Checking user's wrapped native token allowance");
          const allowance = await srcWrappedNativeTokenContract.allowance(
            evmSigner!.address,
            config[srcChainId].limitOrderProtocol
          );
          console.log("🔓 Token allowance:", allowance.toString());
          updateLastStatus("done");

          if (allowance < UINT_256_MAX) {
            addStatus(
              "Approving user's wrapped native token allowance for LOP."
            );
            const tx = await srcWrappedNativeTokenContract.approve(
              config[srcChainId].limitOrderProtocol,
              UINT_256_MAX
            );
            console.log("✍️ Approve TX:", tx.hash);
            await tx.wait();
            updateLastStatus("done", [
              {
                explorerUrl: `${fromChain.exproler}/tx/${tx.hash}`,
                network: fromChain.name,
              },
            ]);
          }
        }

        addStatus("Waiting for the user's signature");
        secret = randomBytes(32);
        hashLock = {
          keccak256: Sdk.HashLock.forSingleFill(uint8ArrayToHex(secret)),
          sha256: bitcoin.crypto.sha256(secret),
        };
        console.log("🔐 Hash lock created", hashLock);

        const timestamp = BigInt(Math.floor(Date.now() / 1000));

        let escrowFacotryAddress = new Address(nullAddress);
        if (config[srcChainId].type === "evm") {
          escrowFacotryAddress = new Address(config[srcChainId].escrowFactory);
        }

        let resolverAddress = new Address(nullAddress);
        if (config[srcChainId].type === "evm") {
          resolverAddress = new Address(config[srcChainId].resolver!);
        }

        let receiver;
        if (config[dstChainId].type === "btc") {
          receiver = new Address(addressToEthAddressFormat(btcUser!.address));
        }

        order = Sdk.CrossChainOrder.new(
          escrowFacotryAddress,
          {
            salt: Sdk.randBigInt(1000n),
            maker: new Address(evmSigner!.address),
            makingAmount: BigInt(amount),
            takingAmount: BigInt(amount),
            makerAsset,
            takerAsset,
            receiver,
          },
          {
            hashLock: hashLock.keccak256,
            timeLocks: Sdk.TimeLocks.new({
              srcWithdrawal: 1n, // to make demo in time
              srcPublicWithdrawal: 1023n,
              srcCancellation: 1024n, // must be 512, 1024... to set relative time check in bitcoin (only when btc = src)
              srcPublicCancellation: 1225n,
              dstWithdrawal: 1n, // to make demo in time
              dstPublicWithdrawal: 511n,
              dstCancellation: 512n,
            }),
            srcChainId: dummySrcChainId,
            dstChainId: dummyDstChainId,
            srcSafetyDeposit: 0n,
            dstSafetyDeposit: 0n,
          },
          {
            auction: new Sdk.AuctionDetails({
              initialRateBump: 0,
              points: [],
              duration: 120n,
              startTime: timestamp,
            }),
            whitelist: [
              {
                address: resolverAddress,
                allowFrom: 0n,
              },
            ],
            resolvingStartTime: 0n,
          },
          {
            nonce: Sdk.randBigInt(UINT_40_MAX),
            allowPartialFills: false,
            allowMultipleFills: false,
          }
        );

        // to bypass chain id, set chain id after order creation
        order.inner.fusionExtension.srcChainId = srcChainId;
        order.inner.fusionExtension.dstChainId = dstChainId;

        if (config[srcChainId].type === "evm") {
          // taker asset is replaced by trueERC20 in SDK, so override here
          order.inner.inner.takerAsset = new Address(
            config[srcChainId].trueERC20!
          );
        }

        console.log("📦 Order constructed:", order);
        extension = order.extension;
        orderHash = getOrderHashWithPatch(srcChainId, order, {
          ...patchedDomain,
          verifyingContract: config[srcChainId].limitOrderProtocol!,
        });
        console.log("📡 Order hash:", orderHash);

        if (config[srcChainId].type === "btc") {
          // @ts-ignore
          const timeLocks = order.inner.fusionExtension.timeLocks;

          const htlcScript = createSrcHtlcScript(
            orderHash,
            hashLock.sha256,
            timeLocks._srcWithdrawal,
            timeLocks._srcCancellation,
            btcUser!.publicKey,
            Buffer.from(btcResolverPublicKey, "hex"),
            false
          );

          const p2sh = bitcoin.payments.p2sh({
            redeem: { output: htlcScript, network },
            network,
          });

          console.log("🧾 HTLC P2SH Address:", p2sh.address);

          const makerPayment = bitcoin.payments.p2wpkh({
            pubkey: btcUser!.publicKey,
            network,
          });

          const fromAddress = makerPayment.address!;

          const utxos = await btcProvider.getUtxos(fromAddress);
          if (!utxos.length) {
            console.error("❌ No UTXOs found in maker's wallet.");
            return;
          }

          const amount = Number(order.makingAmount);
          const fee = 10000;
          const totalInput = utxos.reduce((sum, utxo) => sum + utxo.value, 0);
          const change = totalInput - amount - fee;

          if (change < 0) {
            console.error("❌ Not enough funds to lock BTC and cover the fee.");
            return;
          }

          const psbt = new bitcoin.Psbt({ network });

          if (change > 0) {
            psbt.addOutput({
              address: fromAddress,
              value: change,
            });
          }

          for (const utxo of utxos) {
            psbt.addInput({
              hash: utxo.txid,
              index: utxo.vout,
              witnessUtxo: {
                script: makerPayment.output!,
                value: utxo.value,
              },
            });
          }

          psbt.addOutput({
            script: p2sh.output!,
            value: amount,
          });

          utxos.forEach((_, idx) => {
            psbt.signInput(idx, {
              publicKey: btcUser!.publicKey,
              sign: (hash) => Buffer.from(btcUser!.keyPair.sign(hash)),
            });
          });

          psbt.finalizeAllInputs();

          const txHex = psbt.extractTransaction().toHex();
          // The script includes orderhash, and tx is signed so use this object as signautre
          signature = JSON.stringify({
            txHex,
            htlcScriptHex: htlcScript.toString("hex"),
            p2shAddress: p2sh.address!,
          });
        } else {
          const typedData = order.getTypedData(srcChainId);
          console.log("📝 Signing typed data:", typedData);
          signature = await evmSigner!.signTypedData(
            {
              chainId: srcChainId,
              ...patchedDomain,
              verifyingContract: config[srcChainId].limitOrderProtocol,
            },
            { Order: typedData.types[typedData.primaryType] },
            typedData.message
          );
        }

        order = order.build();
        btcUserPublicKey = btcUser?.publicKey.toString("hex");
        updateLastStatus("done");
      }
      addStatus("Submitting order to relayer");

      console.log("sending params:", {
        hash: orderHash,
        hashLock: {
          sha256: hashLock.sha256.toString("hex"),
        },
        srcChainId,
        dstChainId,
        order,
        extension,
        signature,
        btcUserPublicKey,
      });

      const res = await fetch("/api/relayer/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          {
            hash: orderHash,
            hashLock: {
              sha256: hashLock.sha256.toString("hex"),
            },
            srcChainId,
            dstChainId,
            order,
            extension,
            signature,
            btcUserPublicKey,
          },
          (_, v) => (typeof v === "bigint" ? v.toString() : v)
        ),
      });

      if (!res.ok) throw new Error("Failed to submit order");
      console.log("📨 Order submitted to relayer");
      updateLastStatus("done");

      addStatus("Waiting for escrow creation by resolver");
      while (true) {
        const statusRes = await fetch(
          `/api/relayer/orders/${orderHash}/status`
        );
        const statusJson = await statusRes.json();
        if (statusJson.status === "escrow_created") {
          console.log("🏗️ Escrow created:", statusJson);
          updateLastStatus("done", [
            {
              explorerUrl: `${fromChain.exproler}/tx/${statusJson.srcDeployHash}`,
              network: fromChain.name,
            },
            {
              explorerUrl: `${toChain.exproler}/tx/${statusJson.dstDeployHash}`,
              network: toChain.name,
            },
          ]);
          break;
        }
        await new Promise((r) => setTimeout(r, 3000));
      }

      if (config[dstChainId].type === "btc") {
        addStatus("Redeeming BTC HTLC (BTC requires maker to sign it)");
        console.log("🔁 Starting BTC claim flow");
        const dstWithdrawParamsRes = await fetch(
          `/api/relayer/orders/${orderHash}/btc/dst-withdraw-params`
        );
        if (!dstWithdrawParamsRes.ok)
          throw new Error("Failed to fetch BTC withdraw params");

        const dstWithdrawParamsJson = await dstWithdrawParamsRes.json();
        console.log("📬 BTC withdraw params:", dstWithdrawParamsJson);

        let finalTxId;

        // 2. Decide HOW to claim: via agent or locally.
        if (gattaiWalletConfig) {
          // Agent Flow: Call the backend to sign and broadcast.
          console.log("...via Gattai Wallet Agent");
          const claimRes = await fetch(`${gattaiAgentUrl}/api/claim-btc`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              secret: secret.toString("hex"),
              dstEscrowAddress: dstWithdrawParamsJson.dstEscrowAddress,
              htlcScriptHex: dstWithdrawParamsJson.htlcScript,
              amount: dstWithdrawParamsJson.dstImmutables.amount,
            }),
          });

          if (!claimRes.ok) {
            const errorData = await claimRes.json();
            throw new Error(
              `Failed to claim BTC via Agent: ${errorData.message}`
            );
          }
          const { txId } = await claimRes.json();
          finalTxId = txId;
        } else {
          const rawTxHex = await btcProvider.getRawTransactionHex(
            dstWithdrawParamsJson.dstEscrowAddress
          );

          const spendPsbt = new bitcoin.Psbt({ network });
          console.log(
            "dstWithdrawParamsJson.htlcScript",
            dstWithdrawParamsJson.htlcScript
          );
          const htlcScript = Buffer.from(
            dstWithdrawParamsJson.htlcScript,
            "hex"
          );

          await btcProvider.verifyHTLCScriptHashFromTx(
            dstWithdrawParamsJson.dstEscrowAddress,
            htlcScript
          );

          // this should work after waiting Median Confirmation Time
          // const dstTimeLocks = Sdk.TimeLocks.fromBigInt(
          //   BigInt(dstWithdrawParamsJson.dstImmutables.timelocks)
          // ).toDstTimeLocks();
          // spendPsbt.setLocktime(Number(dstTimeLocks.privateWithdrawal));
          spendPsbt.addInput({
            hash: dstWithdrawParamsJson.dstEscrowAddress,
            index: 0,
            nonWitnessUtxo: Buffer.from(rawTxHex, "hex"),
            redeemScript: htlcScript,
            sequence: 0xfffffffe,
          });

          const redeemFee = 1000;
          const redeemValue =
            dstWithdrawParamsJson.dstImmutables.amount - redeemFee;
          if (redeemValue <= 0) {
            console.error("❌ Not enough value to redeem HTLC.");
            return;
          }

          spendPsbt.addOutput({
            address: btcUser!.address,
            value: redeemValue,
          });

          spendPsbt.signInput(0, {
            publicKey: btcUser!.publicKey,
            sign: (hash) => Buffer.from(btcUser!.keyPair.sign(hash)),
          });

          spendPsbt.finalizeInput(0, (_: number, input: any) => {
            console.log("input", input);

            const signature = input.partialSig[0].signature;
            const unlockingScript = bitcoin.script.compile([
              signature,
              secret,
              bitcoin.opcodes.OP_TRUE,
            ]);

            const payment = bitcoin.payments.p2sh({
              redeem: {
                input: unlockingScript,
                output: htlcScript,
              },
            });

            return {
              finalScriptSig: payment.input,
              finalScriptWitness: undefined,
            };
          });

          const finalTxHex = spendPsbt.extractTransaction().toHex();
          finalTxId = await btcProvider.broadcastTx(finalTxHex);
        }

        console.log("🎉 Maker successfully claimed BTC from HTLC!");
        console.log("✅ Redemption TXID:", finalTxId);

        updateLastStatus("done", [
          {
            explorerUrl: `${toChain.exproler}/tx/${finalTxId}`,
            network: toChain.name,
          },
        ]);
      }

      addStatus("Submitting secret to relayer");
      const secretRes = await fetch(`/api/relayer/orders/${orderHash}/secret`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: uint8ArrayToHex(secret) }),
      });
      if (!secretRes.ok) throw new Error("Failed to share secret");
      updateLastStatus("done");

      addStatus("Waiting for resolver's withdrawal to complete");
      while (true) {
        const statusRes = await fetch(
          `/api/relayer/orders/${orderHash}/status`
        );
        const statusJson = await statusRes.json();
        if (statusJson.status === "withdraw_completed") {
          console.log("✅ Withdrawal complete:", statusJson);
          const explorers = [];

          if (statusJson.srcWithdrawHash) {
            explorers.push({
              explorerUrl: `${fromChain.exproler}/tx/${statusJson.srcWithdrawHash}`,
              network: fromChain.name,
            });
          }

          if (statusJson.dstWithdrawHash) {
            explorers.push({
              explorerUrl: `${toChain.exproler}/tx/${statusJson.dstWithdrawHash}`,
              network: toChain.name,
            });
          }

          updateLastStatus("done", explorers);
          break;
        }
        await new Promise((r) => setTimeout(r, 3000));
      }

      addFinalStatus("Swap Complete! 🎉", "done");
      console.log("✅ Order process completed.");
    } catch (error: any) {
      console.error("❌ Error in createOrder:", error);
      updateLastStatus("failed");
      addFinalStatus(error.message || "An unknown error occurred", "failed");
    }
  };

  return (
    <>
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-800 text-white flex flex-col">
        {/* Header */}
        <div className="flex justify-end md:justify-between items-center px-4 py-4">
          <div
            className="hidden md:block text-2xl font-bold text-blue-400 cursor-pointer"
            onClick={() => showDex && setShowDex(false)}
          >
            Hollow
          </div>
          {/* ====== MODIFIED WALLET DISPLAY LOGIC ====== */}
          <div className="flex items-center gap-4">
            {gattaiWalletConfig ? (
              // If GattaiWallet is connected, show it INSTEAD of other wallets
              <div>
                <button
                  onClick={() => setIsGattaiAccountModalOpen(true)}
                  className="px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-md hover:from-blue-600 hover:to-purple-700 cursor-pointer font-semibold flex items-center gap-2 transition-all"
                >
                  Hollow Wallet
                </button>
              </div>
            ) : (
              // Otherwise, show the individual EVM and BTC wallet statuses
              <>
                {evmSigner && (
                  <ConnectButton
                    chainStatus="icon"
                    accountStatus="avatar"
                    showBalance={false}
                  />
                )}

                {btcUser && (
                  <div>
                    <button
                      onClick={() => setIsBtcAccountModalOpen(true)}
                      className="px-4 py-2 bg-gray-800 border border-gray-600 rounded-md text-white hover:bg-gray-700 cursor-pointer font-mono"
                    >
                      {btcUser.address.slice(0, 6)}...
                      {btcUser.address.slice(-4)}
                    </button>
                  </div>
                )}

                {/* Show a general connect button if not fully connected */}
                {(!evmSigner || !btcUser) && (
                  <button
                    onClick={() => setIsConnectModalOpen(true)}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 cursor-pointer font-semibold"
                  >
                    Connect
                  </button>
                )}
              </>
            )}
          </div>
          {/* ====== END OF MODIFIED LOGIC ====== */}
        </div>

        {/* 2. Hero */}
        {!showDex && (
          <div className="flex-grow flex items-center justify-center px-4">
            <div className="relative text-center max-w-3xl">
              {/* Background Glow */}
              <div className="absolute inset-0 z-0">
                <div className="w-full h-full bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-600/20 via-blue-900/10 to-black"></div>
              </div>

              {/* Hero Content */}
              <div className="relative z-10">
                <div className="relative z-10 flex flex-col items-center text-center">
                  {/* Main Image with title */}
                  <div className="relative inline-block mx-auto">
                    {/* 1inch image above the flame */}
                    <img
                      src="/1inch.png"
                      alt="1inch"
                      className="absolute z-10 max-w-xs md:max-w-sm opacity-15"
                    />

                    <img
                      src="/icon.png"
                      alt="Hollow Character"
                      className="max-w-xs md:max-w-sm rounded-full"
                    />

                    {/* Title over image */}
                    <div className="absolute bottom-14 left-0 right-0 flex flex-col items-center text-center px-4">
                      <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight leading-tight bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-blue-50 to-blue-400 drop-shadow-lg">
                        Hollow
                      </h1>
                    </div>

                    {/* Floating Coins + Slogan */}
                    <div className="absolute bottom-0 left-0 right-0 flex flex-col items-center text-center space-y-3">
                      <div className="flex flex-wrap justify-center gap-6">
                        {coins.map((src, i) => (
                          <img
                            key={i}
                            src={src}
                            alt={`coin-${i}`}
                            className="w-10 h-10 object-contain"
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mt-4 text-sm md:text-lg font-semibold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 via-blue-400 to-cyan-300 tracking-wide">
                  Fusion Unleashed, Chain Abstracted
                </div>
                <div className="mt-4 text-center">
                  <button
                    onClick={() => setShowDex(true)}
                    className="w-full max-w-xs mx-auto py-3 bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-700 hover:to-cyan-600 text-white font-semibold rounded-md transition-all text-base cursor-pointer"
                  >
                    Start
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 3. Dex */}
        {showDex && (
          <div className="flex-grow flex items-center justify-center px-4 py-10">
            <div className="w-full max-w-md bg-gradient-to-br from-gray-800 via-gray-900 to-black border border-blue-900 shadow-xl p-6 rounded-xl space-y-6">
              <div className="flex items-center justify-center gap-2">
                <h2 className="text-xl font-bold text-center text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-cyan-400 to-indigo-500">
                  Cross-Chain Swaps with 1inch Fusion+
                </h2>
              </div>

              {/* From Section */}
              <div className="space-y-2">
                <label className="block text-sm text-gray-300">From</label>
                <div className="flex space-x-2">
                  <select
                    className="flex-1 px-3 py-2 rounded-md bg-gray-700 text-white border border-gray-600 focus:ring-2 focus:ring-blue-500 cursor-pointer"
                    value={fromChain.chainId}
                    onChange={(e) => {
                      const selected = chains.find(
                        (c) => c.chainId === Number(e.target.value)
                      );
                      setFromChain(selected!);
                    }}
                  >
                    {chains.map((chain) => (
                      <option key={chain.chainId} value={chain.chainId}>
                        {chain.name} ({chain.symbol})
                      </option>
                    ))}
                  </select>

                  <input
                    type="text"
                    value={amount}
                    disabled
                    className="w-18 px-3 py-2 rounded-md bg-gray-700 text-gray-400 border border-gray-600 text-sm cursor-not-allowed"
                  />
                </div>
                <p className="text-xs text-blue-200 mt-1">
                  * Amount is fixed to {amount} {fromChain.unit} to keep the
                  demo easier.
                </p>
              </div>
              {/* Swap Button with Icon */}
              <div className="flex justify-center">
                <button
                  onClick={() => {
                    if (isSwapping) {
                      return;
                    }
                    // Trigger animation
                    setIsSwapping(true);
                    setTimeout(() => setIsSwapping(false), 500); // Reset after animation

                    // Swap logic
                    const temp = fromChain;
                    setFromChain(toChain);
                    setToChain(temp);
                  }}
                  className={`rounded-full p-3 bg-gradient-to-r from-blue-600 to-purple-500 text-white shadow-md transition-transform duration-500 ${
                    isSwapping ? "animate-spin" : ""
                  } cursor-pointer`}
                  aria-label="Swap Chains"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M17 8h2a2 2 0 012 2v6m0 0l-4-4m4 4l-4 4M7 16H5a2 2 0 01-2-2V8m0 0l4 4m-4-4l4-4"
                    />
                  </svg>
                </button>
              </div>
              <div className="space-y-2">
                <label className="block text-sm text-gray-300">To</label>
                <div className="flex space-x-2">
                  <select
                    className="flex-1 px-3 py-2 rounded-md bg-gray-700 text-white border border-gray-600 focus:ring-2 focus:ring-cyan-500 cursor-pointer"
                    value={toChain.chainId}
                    onChange={(e) =>
                      setToChain(
                        chains.find(
                          (c) => c.chainId === Number(e.target.value)
                        )!
                      )
                    }
                  >
                    {chains.map((chain) => (
                      <option key={chain.chainId} value={chain.chainId}>
                        {chain.name} ({chain.symbol})
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    disabled
                    value={amount}
                    className="w-18 px-3 py-2 rounded-md bg-gray-700 text-gray-400 border border-gray-600 text-sm cursor-not-allowed"
                  />
                </div>
                <p className="text-xs text-blue-200 mt-1">
                  * You will receive the same amount in {toChain.unit}.
                </p>
              </div>
              {/* Swap Button */}
              <button
                className="w-full py-3 mt-4 bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-700 hover:to-cyan-600 text-white font-semibold rounded-md transition-all text-base cursor-pointer"
                onClick={createOrder}
              >
                Create Order
              </button>
            </div>
          </div>
        )}

        {/* 4. Footer (Always Visible) */}
        <footer className="px-6 py-4 text-sm text-gray-400 flex items-center justify-end">
          <a
            href="https://github.com/taijusanagi/2025-unite"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center space-x-2 hover:text-white transition cursor-pointer"
          >
            <FaGithub className="w-5 h-5" />
          </a>
        </footer>
      </div>

      {/* MODALS */}
      <ConnectModal
        isOpen={isConnectModalOpen}
        onClose={() => setIsConnectModalOpen(false)}
        onConnectEVM={evmConnectWallet}
        onConnectBTC={btcConnectWallet}
        onConnectGattai={onConnectGattai}
        isEvmConnected={!!evmSigner}
        isBtcConnected={!!btcUser}
      />
      <BtcConnectModal
        isOpen={isBtcConnectModalOpen}
        onClose={() => setIsBtcConnectModalOpen(false)}
        onConnect={handleBtcConnect}
      />
      <ConnectGattaiModal
        isOpen={isGattaiConnectModalOpen}
        onClose={() => setIsGattaiConnectModalOpen(false)}
        onConnect={handleGattaiConnect}
      />
      <BtcAccountModal
        isOpen={isBtcAccountModalOpen}
        onClose={() => setIsBtcAccountModalOpen(false)}
        address={btcUser?.address || ""}
        // @ts-ignore
        publicKey={btcUser?.publicKey.toString("hex") || ""}
        onDisconnect={() => {
          localStorage.removeItem("btcPrivateKey");
          setBtcUser(null);
          setIsBtcAccountModalOpen(false);
        }}
      />
      {/* ====== RENDER THE NEW MODAL ====== */}
      {gattaiWalletConfig && (
        <GattaiWalletAccountModal
          isOpen={isGattaiAccountModalOpen}
          onClose={() => setIsGattaiAccountModalOpen(false)}
          onDisconnect={handleGattaiDisconnect}
          evmAddress={gattaiWalletConfig.evmAddress}
          btcAddress={gattaiWalletConfig.btcAddress}
        />
      )}
      <StatusModal
        isOpen={isStatusModalOpen}
        onClose={() => setIsStatusModalOpen(false)}
        statuses={statuses}
        title="Swap in Progress..."
        fromChainName={fromChain.name}
        toChainName={toChain.name}
        fromAmount={amount.toString()}
        toAmount={amount.toString()}
        fromSymbol={fromChain.unit}
        toSymbol={toChain.unit}
      />
    </>
  );
}
