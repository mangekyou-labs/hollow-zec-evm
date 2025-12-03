// File: app/api/relayer/orders/[hash]/dst-withdraw-params/route.ts

import { NextRequest, NextResponse } from "next/server";
import redis, { connectRedis } from "@/lib/redis";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ hash: string }> }
) {
  const { hash } = await context.params;

  if (!hash) {
    return NextResponse.json({ error: "Missing hash" }, { status: 400 });
  }

  try {
    await connectRedis();

    const raw = await redis.hGet("orders", hash);
    if (!raw) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const {
      hashLock,
      dstChainId,
      dstEscrowAddress,
      dstImmutables,
      htlcScript,
    } = JSON.parse(raw);

    if (!hashLock || !dstChainId || !dstEscrowAddress || !dstImmutables) {
      return NextResponse.json(
        { error: "Incomplete order data" },
        { status: 422 }
      );
    }

    return NextResponse.json({
      dstEscrowAddress,
      dstImmutables,
      htlcScript,
    });
  } catch (err) {
    console.error("Error in withdraw-btc-param GET:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
