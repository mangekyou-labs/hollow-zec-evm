import axios, {AxiosInstance} from 'axios'
import * as bitcoin from 'bitcoinjs-lib'
import {hexToUint8Array} from '@1inch/byte-utils'

// NOTE: We reuse bitcoinjs-lib only for SCRIPT CONSTRUCTION.
// Zcash transaction serialization/consensus differences are handled by zcashd
// when we submit scripts via JSON-RPC (e.g. createrawtransaction + signrawtransactionwithwallet).

export type ZecWallet = {
    transparentAddress: string
}

export interface ZcashRpcConfig {
    rpcUrl: string
    rpcUsername: string
    rpcPassword: string
}

export interface ZecUtxo {
    txid: string
    vout: number
    amount: number
    confirmations: number
    spendable?: boolean
}

type JsonRpcRequest = {
    jsonrpc: '2.0'
    id: string
    method: string
    params: any[]
}

type JsonRpcResponse<T> = {
    result: T
    error: {code: number; message: string} | null
    id: string
}

export class ZecProvider {
    private api: AxiosInstance

    constructor(config: ZcashRpcConfig) {
        this.api = axios.create({
            baseURL: config.rpcUrl,
            timeout: 15000,
            auth: {
                username: config.rpcUsername,
                password: config.rpcPassword
            }
        })
    }

    private async rpcCall<T>(method: string, params: any[] = []): Promise<T> {
        const body: JsonRpcRequest = {
            jsonrpc: '2.0',
            id: 'zcash-htlc',
            method,
            params
        }

        const {data} = await this.api.post<JsonRpcResponse<T>>('', body)

        if (data.error) {
            throw new Error(`Zcash RPC error ${data.error.code}: ${data.error.message}`)
        }

        return data.result
    }

    async listUnspent(
        minConf: number,
        maxConf: number,
        addresses: string[]
    ): Promise<ZecUtxo[]> {
        return this.rpcCall<ZecUtxo[]>('listunspent', [minConf, maxConf, addresses])
    }

    async getBalance(address: string, minConf: number = 1): Promise<number> {
        const utxos = await this.listUnspent(minConf, 9999999, [address])
        return utxos.reduce((sum, u) => sum + u.amount, 0)
    }

    async sendRawTransaction(hex: string): Promise<string> {
        return this.rpcCall<string>('sendrawtransaction', [hex])
    }

    async getTransaction(txid: string): Promise<any> {
        return this.rpcCall<any>('gettransaction', [txid])
    }

    async getRawTransaction(txid: string, verbose: boolean = false): Promise<any> {
        return this.rpcCall<any>('getrawtransaction', [txid, verbose ? 1 : 0])
    }

    async waitForTxConfirmation(
        txid: string,
        requiredConfirmations: number = 1,
        timeoutMs: number = 300_000
    ): Promise<{confirmations: number}> {
        const start = Date.now()

        // eslint-disable-next-line no-constant-condition
        while (true) {
            if (Date.now() - start > timeoutMs) {
                throw new Error(`ZEC tx ${txid} not confirmed within ${timeoutMs / 1000}s`)
            }

            try {
                const tx = await this.getTransaction(txid)
                const confirmations = typeof tx.confirmations === 'number' ? tx.confirmations : 0

                if (confirmations >= requiredConfirmations) {
                    return {confirmations}
                }
            } catch (e) {
                // swallow and retry
            }

            await new Promise((resolve) => setTimeout(resolve, 5000))
        }
    }
}

// === HTLC SCRIPT HELPERS (transparent layer) ===

export function createZecSrcHtlcScript(
    orderHashHex: string,
    hashLockSha256: Buffer,
    privateWithdrawalSeconds: number | bigint,
    privateCancellationSeconds: number | bigint,
    userPubKey: Buffer,
    resolverPubKey: Buffer,
    lockTillPrivateWithdrawal: boolean = true
): Buffer {
    const scriptChunks: (Buffer | number)[] = []

    // Unique order hash
    scriptChunks.push(Buffer.from(hexToUint8Array(orderHashHex)))
    scriptChunks.push(bitcoin.opcodes.OP_DROP)

    // Optional relative timelock for withdrawal (CSV-style)
    if (lockTillPrivateWithdrawal) {
        scriptChunks.push(
            bitcoin.script.number.encode(Number(privateWithdrawalSeconds))
        )
        scriptChunks.push(bitcoin.opcodes.OP_CHECKSEQUENCEVERIFY)
        scriptChunks.push(bitcoin.opcodes.OP_DROP)
    }

    // IF branch: resolver + hashlock
    scriptChunks.push(bitcoin.opcodes.OP_IF)
    scriptChunks.push(bitcoin.opcodes.OP_SHA256)
    scriptChunks.push(hashLockSha256)
    scriptChunks.push(bitcoin.opcodes.OP_EQUALVERIFY)
    scriptChunks.push(resolverPubKey)
    scriptChunks.push(bitcoin.opcodes.OP_CHECKSIG)

    // ELSE: user refund after relative timeout
    scriptChunks.push(bitcoin.opcodes.OP_ELSE)
    scriptChunks.push(
        bitcoin.script.number.encode(Number(privateCancellationSeconds))
    )
    scriptChunks.push(bitcoin.opcodes.OP_CHECKSEQUENCEVERIFY)
    scriptChunks.push(bitcoin.opcodes.OP_DROP)
    scriptChunks.push(userPubKey)
    scriptChunks.push(bitcoin.opcodes.OP_CHECKSIG)

    scriptChunks.push(bitcoin.opcodes.OP_ENDIF)

    return bitcoin.script.compile(scriptChunks)
}

export function createZecDstHtlcScript(
    orderHashHex: string,
    hashLockSha256: Buffer,
    privateWithdrawalLockTime: number | bigint,
    privateCancellationLockTime: number | bigint,
    userPubKey: Buffer,
    resolverPubKey: Buffer,
    lockTillPrivateWithdrawal: boolean = true
): Buffer {
    const scriptChunks: (Buffer | number)[] = []

    // Unique order hash
    scriptChunks.push(Buffer.from(hexToUint8Array(orderHashHex)))
    scriptChunks.push(bitcoin.opcodes.OP_DROP)

    if (lockTillPrivateWithdrawal) {
        scriptChunks.push(bitcoin.script.number.encode(Number(privateWithdrawalLockTime)))
        scriptChunks.push(bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY)
        scriptChunks.push(bitcoin.opcodes.OP_DROP)
    }

    // IF branch: user can claim with preimage before cancellation timeout
    scriptChunks.push(bitcoin.opcodes.OP_IF)
    scriptChunks.push(bitcoin.opcodes.OP_SHA256)
    scriptChunks.push(hashLockSha256)
    scriptChunks.push(bitcoin.opcodes.OP_EQUALVERIFY)
    scriptChunks.push(userPubKey)
    scriptChunks.push(bitcoin.opcodes.OP_CHECKSIG)

    // ELSE branch: resolver refund after locktime
    scriptChunks.push(bitcoin.opcodes.OP_ELSE)
    scriptChunks.push(bitcoin.script.number.encode(Number(privateCancellationLockTime)))
    scriptChunks.push(bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY)
    scriptChunks.push(bitcoin.opcodes.OP_DROP)
    scriptChunks.push(resolverPubKey)
    scriptChunks.push(bitcoin.opcodes.OP_CHECKSIG)

    scriptChunks.push(bitcoin.opcodes.OP_ENDIF)

    return bitcoin.script.compile(scriptChunks)
}


