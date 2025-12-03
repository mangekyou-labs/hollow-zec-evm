// app/api/relayer/order/[hash]/escrow/route.ts
import { NextResponse } from "next/server";
import { connectRedis } from "@/lib/redis";
import redis from "@/lib/redis";

// TODO: add finality check

export async function POST(
  req: Request,
  context: { params: Promise<{ hash: string }> }
) {
  try {
    const { hash } = await context.params;
    if (!hash) {
      return NextResponse.json({ error: "Missing hash" }, { status: 400 });
    }

    const {
      dstEscrowAddress,
      srcEscrowAddress,
      dstImmutables,
      srcImmutables,
      srcDeployHash,
      dstDeployHash,
      htlcScript,
    } = await req.json();

    await connectRedis();

    const existing = await redis.hGet("orders", hash);
    if (!existing) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const order = JSON.parse(existing);

    const updated = {
      ...order,
      status: "escrow_created",
      dstEscrowAddress,
      srcEscrowAddress,
      dstImmutables,
      srcImmutables,
      srcDeployHash,
      dstDeployHash,
      htlcScript,
    };

    await redis.hSet("orders", hash, JSON.stringify(updated));

    return NextResponse.json({ status: true });
  } catch (err) {
    console.error("Error updating order escrow:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
