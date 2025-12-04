import axios, {AxiosInstance} from 'axios'
import * as bitcoin from 'bitcoinjs-lib'
import {hexToUint8Array} from '@1inch/byte-utils'

// NOTE: We reuse bitcoinjs-lib only for SCRIPT CONSTRUCTION.
// Zcash transaction serialization/consensus differences are handled by zcashd
// when we submit scripts via JSON-RPC (e.g. createrawtransaction + signrawtransactionwithwallet).
//
// IMPORTANT: Zcash transparent transactions use a DIFFERENT serialization format than Bitcoin.
// Even transparent-only transactions include fields like nJoinSplit, vJoinSplit, etc.
// bitcoinjs-lib creates Bitcoin-format transactions which zcashd cannot decode.
//
// Available solutions:
// 1. Use zcashd RPC: createrawtransaction + signrawtransactionwithwallet (deprecated but works)
// 2. Use librustzcash (Rust) via FFI or separate service
// 3. Manually construct Zcash transaction format (complex, see Zcash Protocol Spec)
// 4. Wait for JavaScript Zcash libraries (none currently exist on npm)
//
// References:
// - Zcash Protocol Spec: https://zips.z.cash/protocol/protocol.pdf
// - librustzcash: https://github.com/zcash/librustzcash
// - zcash_tx_tool: https://github.com/QED-it/zcash_tx_tool

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

        try {
            const {data} = await this.api.post<JsonRpcResponse<T>>('', body)

            if (data.error) {
                throw new Error(`Zcash RPC error ${data.error.code}: ${data.error.message}`)
            }

            return data.result
        } catch (error: any) {
            if (error.response?.data?.error) {
                const rpcError = error.response.data.error
                throw new Error(`Zcash RPC error ${rpcError.code}: ${rpcError.message}`)
            }
            throw error
        }
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

    async createRawTransaction(
        inputs: Array<{txid: string; vout: number; sequence?: number}>,
        outputs: Record<string, number>,
        locktime?: number,
        expiryHeight?: number
    ): Promise<string> {
        const params: any[] = [inputs, outputs]
        if (locktime !== undefined) params.push(locktime)
        if (expiryHeight !== undefined) params.push(expiryHeight)
        return this.rpcCall<string>('createrawtransaction', params)
    }

    async signRawTransaction(
        hex: string,
        prevTxs?: Array<{
            txid: string
            vout: number
            scriptPubKey: string
            redeemScript?: string
            amount: number
        }>,
        privateKeys?: string[],
        sighashType: string = 'ALL'
    ): Promise<{hex: string; complete: boolean}> {
        const params: any[] = [hex]
        if (prevTxs) params.push(prevTxs)
        else params.push(null)
        if (privateKeys) params.push(privateKeys)
        else params.push(null)
        params.push(sighashType)
        return this.rpcCall<{hex: string; complete: boolean}>('signrawtransaction', params)
    }

    async getTransaction(txid: string): Promise<any> {
        return this.rpcCall<any>('gettransaction', [txid])
    }

    async getRawTransaction(txid: string, verbose: boolean = false): Promise<any> {
        return this.rpcCall<any>('getrawtransaction', [txid, verbose ? 1 : 0])
    }
    
    async getBlockCount(): Promise<number> {
        return this.rpcCall<number>('getblockcount', [])
    }
    
    async getNewAddress(type: 'transparent' | 'sapling' | 'orchard' | 'unified' = 'transparent'): Promise<string> {
        if (type === 'transparent') {
            return this.rpcCall<string>('getnewaddress', [])
        }
        return this.rpcCall<string>('z_getnewaddress', [type])
    }
    
    async zSendMany(
        fromAddress: string,
        amounts: Array<{address: string; amount: number; memo?: string}>,
        minConf?: number,
        fee?: number
    ): Promise<string> {
        const params: any[] = [fromAddress, amounts]
        if (minConf !== undefined) params.push(minConf)
        if (fee !== undefined) params.push(fee)
        return this.rpcCall<string>('z_sendmany', params)
    }
    
    async zGetOperationStatus(opids: string[]): Promise<any[]> {
        return this.rpcCall<any[]>('z_getoperationstatus', [opids])
    }
    
    async zGetBalance(address?: string): Promise<number> {
        return this.rpcCall<number>('z_getbalance', address ? [address] : [])
    }
    
    async zListUnspent(minConf?: number, maxConf?: number, addresses?: string[]): Promise<any[]> {
        const params: any[] = []
        if (minConf !== undefined) params.push(minConf)
        if (maxConf !== undefined) params.push(maxConf)
        if (addresses) params.push(addresses)
        return this.rpcCall<any[]>('z_listunspent', params)
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

function readVarInt(buffer: Buffer, offset: number): {value: number; length: number} {
    const first = buffer[offset]
    if (first < 0xfd) {
        return {value: first, length: 1}
    } else if (first === 0xfd) {
        return {value: buffer.readUInt16LE(offset + 1), length: 3}
    } else if (first === 0xfe) {
        return {value: buffer.readUInt32LE(offset + 1), length: 5}
    } else {
        return {value: Number(buffer.readBigUInt64LE(offset + 1)), length: 9}
    }
}

function writeVarInt(value: number): Buffer {
    if (value < 0xfd) {
        return Buffer.from([value])
    } else if (value <= 0xffff) {
        const buf = Buffer.alloc(3)
        buf[0] = 0xfd
        buf.writeUInt16LE(value, 1)
        return buf
    } else if (value <= 0xffffffff) {
        const buf = Buffer.alloc(5)
        buf[0] = 0xfe
        buf.writeUInt32LE(value, 1)
        return buf
    } else {
        const buf = Buffer.alloc(9)
        buf[0] = 0xff
        buf.writeBigUInt64LE(BigInt(value), 1)
        return buf
    }
}

export function insertScriptSigIntoZcashTx(
    unsignedTxHex: string,
    inputIndex: number,
    scriptSig: Buffer,
    rpcCommand?: string
): string {
    const cmd = rpcCommand ? `${rpcCommand} decoderawtransaction` : 'docker exec zcashd-testnet zcash-cli -testnet -rpcuser=zcashuser -rpcpassword=zcashpass -rpcport=18232 decoderawtransaction'
    
    let decoded: any
    try {
        decoded = JSON.parse(
            require('child_process').execSync(
                `${cmd} ${unsignedTxHex}`
            ).toString().trim()
        )
    } catch (e) {
        throw new Error(`Failed to decode transaction for scriptSig insertion: ${(e as Error).message}`)
    }
    
    if (inputIndex >= decoded.vin.length) {
        throw new Error(`Input index ${inputIndex} out of range (${decoded.vin.length} inputs)`)
    }
    
    const vin = decoded.vin[inputIndex]
    const emptyScriptSigHex = vin.scriptSig.hex || ''
    const emptyScriptSig = Buffer.from(emptyScriptSigHex, 'hex')
    
    const tx = Buffer.from(unsignedTxHex, 'hex')
    
    const emptyScriptSigVarInt = writeVarInt(emptyScriptSig.length)
    const emptyScriptSigWithVarInt = Buffer.concat([emptyScriptSigVarInt, emptyScriptSig])
    
    const prevoutHash = Buffer.from(vin.txid, 'hex').reverse()
    const prevoutIndex = Buffer.alloc(4)
    prevoutIndex.writeUInt32LE(vin.vout, 0)
    
    const prevoutAndScript = Buffer.concat([
        prevoutHash,
        prevoutIndex,
        emptyScriptSigWithVarInt
    ])
    
    const prevoutAndScriptIndex = tx.indexOf(prevoutAndScript)
    if (prevoutAndScriptIndex === -1) {
        throw new Error(`Could not find prevout and scriptSig in transaction. Looking for prevout: ${prevoutHash.toString('hex')}, vout: ${vin.vout}`)
    }
    
    const scriptSigVarIntStart = prevoutAndScriptIndex + 32 + 4
    const scriptSigVarInt = readVarInt(tx, scriptSigVarIntStart)
    
    if (scriptSigVarInt.value !== emptyScriptSig.length) {
        throw new Error(`Script length mismatch: expected ${emptyScriptSig.length}, found ${scriptSigVarInt.value} at offset ${scriptSigVarIntStart}`)
    }
    
    const scriptSigStart = scriptSigVarIntStart
    const scriptSigDataStart = scriptSigStart + scriptSigVarInt.length
    const sequenceStart = scriptSigDataStart + emptyScriptSig.length
    
    if (sequenceStart + 4 > tx.length) {
        throw new Error(`Invalid sequenceStart: ${sequenceStart}, tx length: ${tx.length}`)
    }
    
    const newScriptLen = writeVarInt(scriptSig.length)
    const sizeDiff = (newScriptLen.length + scriptSig.length) - (scriptSigVarInt.length + emptyScriptSig.length)

    const result = Buffer.alloc(tx.length + sizeDiff)
    let resultOffset = 0

    resultOffset += tx.copy(result, resultOffset, 0, scriptSigStart)
    newScriptLen.copy(result, resultOffset)
    resultOffset += newScriptLen.length
    scriptSig.copy(result, resultOffset)
    resultOffset += scriptSig.length
    resultOffset += tx.copy(result, resultOffset, sequenceStart)

    return result.toString('hex')
}

export function calculateZcashSignatureHash(
    unsignedTxHex: string,
    inputIndex: number,
    prevOutScript: Buffer,
    hashType: number,
    rpcCommand?: string
): Buffer {
    const cmd = rpcCommand ? `${rpcCommand} decoderawtransaction` : 'docker exec zcashd-testnet zcash-cli -testnet -rpcuser=zcashuser -rpcpassword=zcashpass -rpcport=18232 decoderawtransaction'
    
    let decoded: any
    try {
        decoded = JSON.parse(
            require('child_process').execSync(
                `${cmd} ${unsignedTxHex}`
            ).toString().trim()
        )
    } catch (e) {
        throw new Error(`Failed to decode transaction: ${(e as Error).message}`)
    }
    
    const preimage = Buffer.alloc(2000)
    let offset = 0
    
    const version = decoded.version & 0x7fffffff
    preimage.writeUInt32LE(version, offset)
    offset += 4
    
    const vinCountBytes = writeVarInt(decoded.vin.length)
    vinCountBytes.copy(preimage, offset)
    offset += vinCountBytes.length
    
    for (let i = 0; i < decoded.vin.length; i++) {
        const vin = decoded.vin[i]
        const prevoutHash = Buffer.from(vin.txid, 'hex').reverse()
        prevoutHash.copy(preimage, offset)
        offset += 32
        preimage.writeUInt32LE(vin.vout, offset)
        offset += 4
        
        if (i === inputIndex) {
            const scriptLenBytes = writeVarInt(prevOutScript.length)
            scriptLenBytes.copy(preimage, offset)
            offset += scriptLenBytes.length
            prevOutScript.copy(preimage, offset)
            offset += prevOutScript.length
        } else {
            const scriptLenBytes = writeVarInt(0)
            scriptLenBytes.copy(preimage, offset)
            offset += scriptLenBytes.length
        }
        
        preimage.writeUInt32LE(vin.sequence, offset)
        offset += 4
    }
    
    const voutCountBytes = writeVarInt(decoded.vout.length)
    voutCountBytes.copy(preimage, offset)
    offset += voutCountBytes.length
    
    for (const vout of decoded.vout) {
        const value = Math.round(vout.value * 1e8)
        preimage.writeBigUInt64LE(BigInt(value), offset)
        offset += 8
        const scriptPubKey = Buffer.from(vout.scriptPubKey.hex, 'hex')
        const scriptLenBytes = writeVarInt(scriptPubKey.length)
        scriptLenBytes.copy(preimage, offset)
        offset += scriptLenBytes.length
        scriptPubKey.copy(preimage, offset)
        offset += scriptPubKey.length
    }
    
    preimage.writeUInt32LE(decoded.locktime, offset)
    offset += 4
    
    preimage.writeUInt32LE(hashType, offset)
    offset += 4
    
    return bitcoin.crypto.hash256(preimage.slice(0, offset))
}
