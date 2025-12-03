// app/api/order/route.ts
import { NextResponse } from "next/server";
import redis, { connectRedis } from "@/lib/redis";

export async function POST(req: Request) {
  try {
    const {
      hash,
      hashLock,
      srcChainId,
      dstChainId,
      order,
      extension,
      signature,
      btcUserPublicKey,
    } = await req.json();

    if (
      !hash ||
      !hashLock ||
      !srcChainId ||
      !dstChainId ||
      !order ||
      !extension ||
      !signature
    ) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    if ((srcChainId === 99999 || dstChainId === 999) && !btcUserPublicKey) {
      return NextResponse.json(
        { error: "Missing fields: btcUserPublicKey" },
        { status: 400 }
      );
    }

    const payload = {
      hashLock,
      srcChainId,
      dstChainId,
      order,
      extension,
      signature,
      btcUserPublicKey,
      status: "order_created",
    };

    await connectRedis();
    await redis.hSet("orders", hash, JSON.stringify(payload));

    fetch(`${process.env.APP_URL}/api/resolver/orders/${hash}/escrow`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Redis error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
