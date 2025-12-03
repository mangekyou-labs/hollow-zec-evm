// app/api/admin/refill/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Wallet, Contract, parseEther, JsonRpcProvider } from "ethers";
import { config } from "@sdk/config";

import IWETHContract from "@sdk/evm/contracts/IWETH.json";
import ResolverContract from "@sdk/evm/contracts/Resolver.json";
import { UINT_256_MAX } from "@1inch/byte-utils";

const privateKey = process.env.ETH_PRIVATE_KEY || "0x";
const adminPassword = process.env.ADMIN_PASSWORD || "";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const password = url.searchParams.get("password");

  if (password !== adminPassword) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const depositAmount = parseEther("0.01");

  const results: Record<string, string> = {};

  for (const [chainIdStr, chain] of Object.entries(config)) {
    if (chain.type != "evm") {
      continue;
    }
    const chainId = Number(chainIdStr);
    const label = `chain:${chainId}`;
    console.log(`\n[${label}] Starting process...`);

    try {
      console.log(`[${label}] Initializing provider and wallet...`);
      const provider = new JsonRpcProvider(chain.rpc);
      const wallet = new Wallet(privateKey, provider);

      const WETH = new Contract(
        chain.wrappedNative!,
        IWETHContract.abi,
        wallet
      );
      const Resolver = new Contract(
        chain.resolver!,
        ResolverContract.abi,
        wallet
      );

      console.log(`[${label}] Checking ETH balance of resolver...`);
      const resolverETHBalance = await provider.getBalance(chain.resolver!);
      console.log(
        `[${label}] Resolver ETH balance: ${resolverETHBalance.toString()}`
      );

      if (resolverETHBalance < depositAmount) {
        console.log(`[${label}] Sending ETH to resolver...`);
        const tx = await wallet.sendTransaction({
          to: chain.resolver,
          value: depositAmount,
        });
        await tx.wait();
        console.log(`[${label}] ETH sent. Tx hash: ${tx.hash}`);
      }

      console.log(`[${label}] Checking resolver WETH balance...`);
      const resolverWETHBalance = await WETH.balanceOf(chain.resolver);
      console.log(
        `[${label}] Resolver WETH balance: ${resolverWETHBalance.toString()}`
      );

      if (resolverWETHBalance < depositAmount) {
        console.log(`[${label}] Depositing WETH...`);
        const depositTx = await WETH.deposit({ value: depositAmount });
        await depositTx.wait();
        console.log(`[${label}] WETH deposited. Tx hash: ${depositTx.hash}`);

        console.log(`[${label}] Transferring WETH to resolver...`);
        const transferTx = await WETH.transfer(chain.resolver, depositAmount);
        await transferTx.wait();
        console.log(`[${label}] WETH transferred. Tx hash: ${transferTx.hash}`);
      }

      console.log(`[${label}] Checking resolver WETH allowance...`);
      const resolverWETHAllowance = await WETH.allowance(
        chain.resolver,
        chain.escrowFactory
      );
      console.log(
        `[${label}] Resolver WETH allowance: ${resolverWETHAllowance.toString()}`
      );

      if (resolverWETHAllowance < UINT_256_MAX) {
        console.log(`[${label}] Approving escrow factory from resolver...`);
        const approveData = WETH.interface.encodeFunctionData("approve", [
          chain.escrowFactory,
          UINT_256_MAX,
        ]);
        const tx = await Resolver.arbitraryCalls(
          [chain.wrappedNative],
          [approveData]
        );
        await tx.wait();
        console.log(
          `[${label}] Approval transaction sent. Tx hash: ${tx.hash}`
        );
      }

      results[label] = "Success";
      console.log(`[${label}] ✅ Completed successfully`);
    } catch (err: any) {
      console.error(`❌ [${label}] Error:`, err.message);
      results[label] = `Error: ${err.message}`;
    }
  }

  return NextResponse.json(results);
}
