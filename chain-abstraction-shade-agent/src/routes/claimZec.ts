import { Hono } from "hono";
import { ZecProvider, createZecDstHtlcScript } from "../../../chains/sdk/zcash";

const app = new Hono();

// This endpoint claims a Zcash HTLC on the destination chain using the revealed preimage.
app.post("/", async (c) => {
  try {
    const {
      orderHashHex,
      hashLockSha256Hex,
      dstHtlcTxId,
      dstHtlcVout,
      dstAmount,
      userPubKeyHex,
      resolverPubKeyHex,
      privateWithdrawalLockTime,
      privateCancellationLockTime,
      zcashRpcUrl,
      zcashRpcUsername,
      zcashRpcPassword,
      preimageHex,
      signedClaimTxHex,
    } = await c.req.json();

    const zecProvider = new ZecProvider({
      rpcUrl: zcashRpcUrl,
      rpcUsername: zcashRpcUsername,
      rpcPassword: zcashRpcPassword,
    });

    // Optional: compute and log the expected HTLC script; actual spending logic
    // is handled off-chain where the transaction was constructed.
    const hashLockSha256 = Buffer.from(hashLockSha256Hex, "hex");
    const userPubKey = Buffer.from(userPubKeyHex, "hex");
    const resolverPubKey = Buffer.from(resolverPubKeyHex, "hex");

    createZecDstHtlcScript(
      orderHashHex,
      hashLockSha256,
      privateWithdrawalLockTime,
      privateCancellationLockTime,
      userPubKey,
      resolverPubKey,
      true
    );

    const txId = await zecProvider.sendRawTransaction(signedClaimTxHex);

    return c.json({ txId });
  } catch (err: any) {
    console.error("❌ ZEC claim failed:", err.message);
    return c.json(
      { success: false, message: err.message, stack: err.stack },
      500
    );
  }
});

export default app;


