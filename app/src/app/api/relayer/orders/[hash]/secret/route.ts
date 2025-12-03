// app/api/relayer/orders/[hash]/secret/route.ts
import { NextResponse } from "next/server";
import { connectRedis } from "@/lib/redis";
import redis from "@/lib/redis";

export async function POST(
  req: Request,
  context: { params: Promise<{ hash: string }> }
) {
  try {
    const { hash } = await context.params;
    if (!hash) {
      return NextResponse.json({ error: "Missing hash" }, { status: 400 });
    }

    const { secret } = await req.json();
    if (!secret) {
      return NextResponse.json({ error: "Missing secret" }, { status: 400 });
    }

    await connectRedis();

    const raw = await redis.hGet("orders", hash);
    if (!raw) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const {
      srcChainId,
      dstChainId,
      hashLock,
      dstEscrowAddress,
      srcEscrowAddress,
      dstImmutables,
      srcImmutables,
      btcUserRecipientKey,
      htlcScript,
    } = JSON.parse(raw);

    fetch(`${process.env.APP_URL}/api/resolver/orders/${hash}/withdraw`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hashLock,
        srcChainId,
        dstChainId,
        dstEscrowAddress,
        srcEscrowAddress,
        dstImmutables,
        srcImmutables,
        btcUserRecipientKey,
        secret,
        htlcScript,
      }),
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Secret relay error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
