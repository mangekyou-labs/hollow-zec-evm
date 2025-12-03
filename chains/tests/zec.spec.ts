import {expect, jest} from '@jest/globals'
import * as bitcoin from 'bitcoinjs-lib'
import {ECPairFactory} from 'ecpair'
import * as secp256k1 from '@bitcoinerlab/secp256k1'
import {randomBytes} from 'crypto'

import {createZecSrcHtlcScript, createZecDstHtlcScript} from '../sdk/zcash'

const ECPair = ECPairFactory(secp256k1)

jest.setTimeout(1000 * 60)

describe('zec HTLC scripts', () => {
    const network = bitcoin.networks.testnet

    it('constructs a valid src HTLC script with hashlock and relative timelocks', () => {
        const orderHash = `0x${randomBytes(32).toString('hex')}`
        const secret = randomBytes(32)
        const hashLockSha256 = bitcoin.crypto.sha256(secret)

        const userKeyPair = ECPair.makeRandom({network})
        const resolverKeyPair = ECPair.makeRandom({network})

        const privateWithdrawal = 512n
        const privateCancellation = 1024n

        const script = createZecSrcHtlcScript(
            orderHash,
            hashLockSha256,
            privateWithdrawal,
            privateCancellation,
            Buffer.from(userKeyPair.publicKey),
            Buffer.from(resolverKeyPair.publicKey),
            true
        )

        const decompiled = bitcoin.script.decompile(script)!

        // First push should be the order hash, followed by OP_DROP
        expect(Buffer.isBuffer(decompiled[0])).toBe(true)
        expect(decompiled[1]).toBe(bitcoin.opcodes.OP_DROP)

        // Script should contain OP_SHA256 and OP_CHECKSEQUENCEVERIFY opcodes
        expect(decompiled).toContain(bitcoin.opcodes.OP_SHA256)
        expect(decompiled).toContain(bitcoin.opcodes.OP_CHECKSEQUENCEVERIFY)
    })

    it('constructs a valid dst HTLC script with hashlock and absolute timelocks', () => {
        const orderHash = `0x${randomBytes(32).toString('hex')}`
        const secret = randomBytes(32)
        const hashLockSha256 = bitcoin.crypto.sha256(secret)

        const userKeyPair = ECPair.makeRandom({network})
        const resolverKeyPair = ECPair.makeRandom({network})

        const privateWithdrawalLockTime = 500000000n
        const privateCancellationLockTime = 500000100n

        const script = createZecDstHtlcScript(
            orderHash,
            hashLockSha256,
            privateWithdrawalLockTime,
            privateCancellationLockTime,
            Buffer.from(userKeyPair.publicKey),
            Buffer.from(resolverKeyPair.publicKey),
            true
        )

        const decompiled = bitcoin.script.decompile(script)!

        // First push should be the order hash, followed by OP_DROP
        expect(Buffer.isBuffer(decompiled[0])).toBe(true)
        expect(decompiled[1]).toBe(bitcoin.opcodes.OP_DROP)

        // Script should contain OP_SHA256 and OP_CHECKLOCKTIMEVERIFY opcodes
        expect(decompiled).toContain(bitcoin.opcodes.OP_SHA256)
        expect(decompiled).toContain(bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY)
    })
})
