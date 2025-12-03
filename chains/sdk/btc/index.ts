import * as bitcoin from 'bitcoinjs-lib'

import {ECPairFactory, ECPairInterface} from 'ecpair'
import axios, {AxiosInstance} from 'axios'
import {hexToUint8Array} from '@1inch/byte-utils'

//@ts-ignore
import ecc from '@bitcoinerlab/secp256k1'
const ECPair = ECPairFactory(ecc)

//@ts-ignore
import bip68 from 'bip68'

export type BtcWallet = {
    keyPair: ECPairInterface
    publicKey: Buffer
    address: string
}

export function addressToEthAddressFormat(btcAddress: string): string {
    const {data} = bitcoin.address.fromBech32(btcAddress)
    return `0x${data.toString('hex')}`
}

export function publicKeyToAddress(publicKey: Buffer | string, network: bitcoin.Network): string {
    const pubkeyBuffer = typeof publicKey === 'string' ? Buffer.from(publicKey, 'hex') : publicKey

    return bitcoin.payments.p2wpkh({pubkey: pubkeyBuffer, network}).address!
}

export function walletFromWIF(
    wif: string,
    network: bitcoin.Network
): {
    keyPair: ECPairInterface
    publicKey: Buffer
    address: string
} {
    const keyPair = ECPair.fromWIF(wif, network)
    const publicKey = Buffer.from(keyPair.publicKey)
    const address = publicKeyToAddress(publicKey, network)
    return {
        keyPair,
        publicKey,
        address
    }
}

interface UTXO {
    txid: string
    vout: number
    value: number
}

export class BtcProvider {
    private api: AxiosInstance
    private network: string

    constructor(apiBase: string, network: string = 'mainnet') {
        this.network = network
        this.api = axios.create({
            baseURL: apiBase,
            timeout: 10000
        })
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms))
    }

    async getUtxos(address: string): Promise<UTXO[]> {
        const res = await this.api.get(`/address/${address}/utxo`)
        return res.data.map((o: any) => ({
            txid: o.txid,
            vout: o.vout,
            value: o.value
        }))
    }

    async getBalance(address: string): Promise<number> {
        const utxos = await this.getUtxos(address)
        return utxos.reduce((sum, utxo) => sum + utxo.value, 0)
    }

    async broadcastTx(txHex: string): Promise<string> {
        const res = await this.api.post('/tx', txHex, {
            headers: {'Content-Type': 'text/plain'}
        })
        return res.data
    }

    async waitForTxConfirmation(
        txid: string,
        timeoutMs = 300_000
    ): Promise<{confirmedAt: string; blockHeight: number}> {
        const start = Date.now()

        while (Date.now() - start < timeoutMs) {
            try {
                const txData = await this.api.get(`/tx/${txid}`).then((res) => res.data)
                const status = txData.status

                if (status && status.confirmed) {
                    const confirmedAt = status.block_time
                    const blockHeight = status.block_height

                    console.log(`✅ TX ${txid} confirmed in block ${blockHeight} at ${confirmedAt}`)
                    return {confirmedAt, blockHeight}
                }

                console.log(`⏳ Waiting for TX ${txid} confirmation...`)
            } catch (err: any) {
                console.warn(`⚠️ Error fetching TX ${txid}:`, err.message)
            }

            await this.delay(5000)
        }

        throw new Error(`❌ Transaction ${txid} not confirmed within ${timeoutMs / 1000} seconds.`)
    }

    async waitForUtxo(address: string, timeoutMs = 10000): Promise<UTXO[]> {
        const start = Date.now()
        while (Date.now() - start < timeoutMs) {
            const utxos = await this.getUtxos(address)
            if (utxos.length > 0) return utxos
            await this.delay(1000)
        }
        throw new Error(`UTXOs not found for ${address} after ${timeoutMs}ms`)
    }

    async getUtxosFromTxid(txid: string): Promise<UTXO[]> {
        const tx = await this.api.get(`/tx/${txid}`).then((res) => res.data)

        const utxos: UTXO[] = []

        for (let i = 0; i < tx.vout.length; i++) {
            const outspend = await this.api.get(`/tx/${txid}/outspend/${i}`).then((res) => res.data)

            if (!outspend.spent) {
                utxos.push({
                    txid,
                    vout: i,
                    value: tx.vout[i].value
                })
            }
        }

        return utxos
    }

    async getRawTransactionHex(txid: string): Promise<string> {
        const res = await this.api.get(`/tx/${txid}/hex`)
        return res.data
    }

    async verifyHTLCScriptHashFromTx(txid: string, htlcScript: Buffer): Promise<void> {
        const scriptHash = bitcoin.crypto.hash160(htlcScript)

        const txHex = await this.api.get(`/tx/${txid}/hex`).then((res) => res.data)
        const tx = bitcoin.Transaction.fromHex(txHex)

        const expectedOutputScript = bitcoin.script.compile([
            bitcoin.opcodes.OP_HASH160,
            scriptHash,
            bitcoin.opcodes.OP_EQUAL
        ])

        const match = tx.outs.find((out) => out.script.equals(expectedOutputScript))

        if (match) {
            console.log('✅ HTLC script hash verified on-chain!')
        } else {
            console.error('❌ HTLC script hash mismatch. Script may not be correct.')
        }
    }
}

export function createSrcHtlcScript(
    orderHashHex: string,
    hashLockSha256: Buffer,
    privateWithdrawal: number | bigint,
    privateCancellation: number | bigint,
    btcUserPublicKey: Buffer,
    btcResolverPublicKey: Buffer,
    lockTillPrivateWithdrawal: boolean = true
): Buffer {
    const scriptChunks: (Buffer | number)[] = []

    // Include unique order hash at the start
    scriptChunks.push(Buffer.from(hexToUint8Array(orderHashHex)))
    scriptChunks.push(bitcoin.opcodes.OP_DROP)

    // Optional withdrawal lock
    if (lockTillPrivateWithdrawal) {
        scriptChunks.push(bitcoin.script.number.encode(bip68.encode({seconds: Number(privateWithdrawal)})))
        scriptChunks.push(bitcoin.opcodes.OP_CHECKSEQUENCEVERIFY)
        scriptChunks.push(bitcoin.opcodes.OP_DROP)
    } else {
        console.warn('⚠️ lockTillPrivateWithdrawal is disabled — not recommended for production use')
    }

    // Begin IF branch: hashlock & resolver
    scriptChunks.push(bitcoin.opcodes.OP_IF)
    scriptChunks.push(bitcoin.opcodes.OP_SHA256)
    scriptChunks.push(hashLockSha256)
    scriptChunks.push(bitcoin.opcodes.OP_EQUALVERIFY)
    scriptChunks.push(btcResolverPublicKey)
    scriptChunks.push(bitcoin.opcodes.OP_CHECKSIG)

    // ELSE branch: timeout & user
    scriptChunks.push(bitcoin.opcodes.OP_ELSE)
    scriptChunks.push(bitcoin.script.number.encode(bip68.encode({seconds: Number(privateCancellation)})))
    scriptChunks.push(bitcoin.opcodes.OP_CHECKSEQUENCEVERIFY)
    scriptChunks.push(bitcoin.opcodes.OP_DROP)
    scriptChunks.push(btcUserPublicKey)
    scriptChunks.push(bitcoin.opcodes.OP_CHECKSIG)

    scriptChunks.push(bitcoin.opcodes.OP_ENDIF)

    return bitcoin.script.compile(scriptChunks)
}

export function createDstHtlcScript(
    orderHashHex: string,
    hashLockSha256: Buffer,
    privateWithdrawal: number | bigint,
    privateCancellation: number | bigint,
    btcUserPublicKey: Buffer,
    btcResolverPublicKey: Buffer,
    lockTillPrivateWithdrawal: boolean = true // optional flag
): Buffer {
    const scriptChunks: (Buffer | number)[] = []

    // Always include a unique order hash at the start for protection
    scriptChunks.push(Buffer.from(hexToUint8Array(orderHashHex)))
    scriptChunks.push(bitcoin.opcodes.OP_DROP)

    if (lockTillPrivateWithdrawal) {
        // Optional timelock enforced at script level
        scriptChunks.push(bitcoin.script.number.encode(Number(privateWithdrawal)))
        scriptChunks.push(bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY)
        scriptChunks.push(bitcoin.opcodes.OP_DROP)
    } else {
        console.warn(
            '⚠️ lockTillPrivateWithdrawal is disabled — for demo/UI only. Real usage should enforce start time.'
        )
    }

    scriptChunks.push(bitcoin.opcodes.OP_IF)
    scriptChunks.push(bitcoin.opcodes.OP_SHA256)
    scriptChunks.push(hashLockSha256)
    scriptChunks.push(bitcoin.opcodes.OP_EQUALVERIFY)
    scriptChunks.push(btcUserPublicKey)
    scriptChunks.push(bitcoin.opcodes.OP_CHECKSIG)

    scriptChunks.push(bitcoin.opcodes.OP_ELSE)
    scriptChunks.push(bitcoin.script.number.encode(Number(privateCancellation)))
    scriptChunks.push(bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY)
    scriptChunks.push(bitcoin.opcodes.OP_DROP)
    scriptChunks.push(btcResolverPublicKey)
    scriptChunks.push(bitcoin.opcodes.OP_CHECKSIG)

    scriptChunks.push(bitcoin.opcodes.OP_ENDIF)

    return bitcoin.script.compile(scriptChunks)
}
