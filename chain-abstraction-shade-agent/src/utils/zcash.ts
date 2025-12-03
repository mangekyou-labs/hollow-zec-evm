import axios, {AxiosInstance} from "axios";

type ZcashRpcConfig = {
  rpcUrl: string;
  rpcUsername: string;
  rpcPassword: string;
};

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params: any[];
};

type JsonRpcResponse<T> = {
  result: T;
  error: { code: number; message: string } | null;
  id: string;
};

export class ZecRpc {
  private api: AxiosInstance;

  constructor(config: ZcashRpcConfig) {
    this.api = axios.create({
      baseURL: config.rpcUrl,
      timeout: 15000,
      auth: {
        username: config.rpcUsername,
        password: config.rpcPassword,
      },
    });
  }

  private async rpcCall<T>(method: string, params: any[] = []): Promise<T> {
    const body: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: "shade-zcash",
      method,
      params,
    };

    const { data } = await this.api.post<JsonRpcResponse<T>>("", body);

    if (data.error) {
      throw new Error(`Zcash RPC error ${data.error.code}: ${data.error.message}`);
    }

    return data.result;
  }

  async getNewTransparentAddress(): Promise<string> {
    // Returns a new t-address from the node wallet
    return this.rpcCall<string>("getnewaddress", []);
  }

  async listUnspent(
    minConf: number,
    maxConf: number,
    addresses: string[]
  ): Promise<
    {
      txid: string;
      vout: number;
      amount: number;
      confirmations: number;
      spendable?: boolean;
    }[]
  > {
    return this.rpcCall("listunspent", [minConf, maxConf, addresses]);
  }

  async getBalance(address: string, minConf: number = 1): Promise<number> {
    const utxos = await this.listUnspent(minConf, 9999999, [address]);
    return utxos.reduce((sum, u) => sum + u.amount, 0);
  }

  async sendRawTransaction(hex: string): Promise<string> {
    return this.rpcCall<string>("sendrawtransaction", [hex]);
  }

  async getTransaction(txid: string): Promise<any> {
    return this.rpcCall<any>("gettransaction", [txid]);
  }

  // --- Shielded helpers (Sapling/Orchard) ---

  /**
   * Send from a shielded or transparent address to one or more recipients.
   * This wraps zcashd's z_sendmany and returns the operation id.
   */
  async zSendMany(
    fromAddress: string,
    recipients: { address: string; amount: number; memo?: string }[],
    minConf: number = 1
  ): Promise<string> {
    const formattedRecipients = recipients.map((r) => ({
      address: r.address,
      amount: r.amount,
      memo: r.memo,
    }));

    return this.rpcCall<string>("z_sendmany", [
      fromAddress,
      formattedRecipients,
      minConf,
    ]);
  }

  /**
   * Polls z_getoperationresult to wait for a z_sendmany operation
   * to complete and returns its result.
   */
  async waitForOperation(
    opId: string,
    timeoutMs: number = 300_000
  ): Promise<any> {
    const start = Date.now();

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(`ZEC shielded op ${opId} not completed within ${timeoutMs / 1000}s`);
      }

      const result = await this.rpcCall<any[]>("z_getoperationresult", [
        [opId],
      ]);

      if (result && result.length > 0) {
        const op = result[0];
        if (op.status === "success") {
          return op;
        }
        if (op.status === "error") {
          throw new Error(`ZEC shielded op failed: ${JSON.stringify(op, null, 2)}`);
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }

  async waitForTxConfirmation(
    txid: string,
    requiredConfirmations: number = 1,
    timeoutMs: number = 300_000
  ): Promise<{ confirmations: number }> {
    const start = Date.now();

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(`ZEC tx ${txid} not confirmed within ${timeoutMs / 1000}s`);
      }

      try {
        const tx = await this.getTransaction(txid);
        const confirmations =
          typeof tx.confirmations === "number" ? tx.confirmations : 0;

        if (confirmations >= requiredConfirmations) {
          return { confirmations };
        }
      } catch {
        // swallow and retry
      }

      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}


