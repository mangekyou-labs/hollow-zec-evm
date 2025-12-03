import * as bitcoin from 'bitcoinjs-lib'
import axios from 'axios'
import ecc from '@bitcoinerlab/secp256k1'
import {ECPairFactory, ECPairInterface} from 'ecpair'
import crypto from 'crypto'

type AddressType = 'p2pkh' | 'p2wpkh'

const ECPair = ECPairFactory(ecc)

const NETWORK = process.env.NETWORK === 'regtest' ? 'regtest' : 'testnet'
const network = NETWORK === 'regtest' ? bitcoin.networks.regtest : bitcoin.networks.testnet

const API_BASE = NETWORK === 'regtest' ? 'http://localhost:8094/regtest/api' : 'https://blockstream.info/testnet/api'

const privKeyA = process.env.BTC_PRIVATE_KEY_1 || ECPair.makeRandom({network}).toWIF()
const privKeyB = process.env.BTC_PRIVATE_KEY_2 || ECPair.makeRandom({network}).toWIF()

const keyPairA: ECPairInterface = ECPair.fromWIF(privKeyA, network)
const keyPairB: ECPairInterface = ECPair.fromWIF(privKeyB, network)

const pubKeyA = Buffer.from(keyPairA.publicKey)
const pubKeyB = Buffer.from(keyPairB.publicKey)

const userLegacyAddress = bitcoin.payments.p2pkh({
    pubkey: pubKeyA,
    network
}).address
const userBech32Address = bitcoin.payments.p2wpkh({
    pubkey: pubKeyA,
    network
}).address
const resolverLegacyAddress = bitcoin.payments.p2pkh({
    pubkey: pubKeyB,
    network
}).address
const resolverBech32Address = bitcoin.payments.p2wpkh({
    pubkey: pubKeyB,
    network
}).address

console.log('User Address (P2PKH):', userLegacyAddress)
console.log('User Address (Bech32):', userBech32Address)
console.log('User Private Key (WIF):', privKeyA)
console.log('Resolver Address (P2PKH):', resolverLegacyAddress)
console.log('Resolver Address (Bech32):', resolverBech32Address)
console.log('Resolver Private Key (WIF):', privKeyB)

async function fetchWithRetry<T>(fn: () => Promise<T>, maxRetries = 10, baseDelay = 500): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn()
        } catch (err) {
            if (attempt === maxRetries) {
                console.error(`❌ Failed after ${maxRetries + 1} attempts.`)
                throw err
            }
            const delay = Math.pow(2, attempt) * baseDelay
            console.warn(`⚠️ Attempt ${attempt + 1} failed. Retrying in ${delay}ms...`)
            await new Promise((resolve) => setTimeout(resolve, delay))
        }
    }
    throw new Error('Unreachable')
}

interface UTXO {
    txid: string
    vout: number
    value: number
}

async function getUtxos(address: string): Promise<UTXO[]> {
    const res = await fetchWithRetry(() => axios.get(`${API_BASE}/address/${address}/utxo`))

    return res.data.map((o: any) => ({
        txid: o.txid,
        vout: o.vout,
        value: o.value
    }))
}

async function getBalance(address: string): Promise<number> {
    const utxos = await getUtxos(address)
    return utxos.reduce((sum: number, utxo: UTXO) => sum + utxo.value, 0)
}

async function broadcastTx(txHex: string): Promise<string> {
    const res = await axios.post(`${API_BASE}/tx`, txHex, {
        headers: {'Content-Type': 'text/plain'}
    })
    return res.data
}

async function waitForUtxo(address: string, timeoutMs = 10000): Promise<UTXO[]> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
        const utxos = await getUtxos(address)
        if (utxos.length > 0) return utxos
        await new Promise((r) => setTimeout(r, 1000))
    }
    throw new Error(`UTXOs not found for ${address} after ${timeoutMs}ms`)
}

async function waitForTxConfirmation(
    txid: string,
    timeoutMs = 300_000
): Promise<{confirmedAt: string; blockHeight: number}> {
    const start = Date.now()

    while (Date.now() - start < timeoutMs) {
        const txData = await fetchWithRetry(() => axios.get(`${API_BASE}/tx/${txid}`).then((res) => res.data))

        const status = txData.status
        if (status && status.confirmed) {
            const confirmedAt = status.block_time
            const blockHeight = status.block_height

            console.log(`✅ TX ${txid} confirmed in block ${blockHeight} at ${confirmedAt}`)
            return {confirmedAt, blockHeight}
        }

        console.log(`⏳ Waiting for TX ${txid} confirmation...`)
        await new Promise((resolve) => setTimeout(resolve, 5000))
    }

    throw new Error(`❌ Transaction ${txid} not confirmed within ${timeoutMs / 1000} seconds.`)
}

async function sendBitcoin({
    fromWIF,
    toAddress,
    amountSats,
    fromType = 'p2pkh'
}: {
    fromWIF: string
    toAddress: string
    amountSats: number
    fromType?: AddressType
}): Promise<void> {
    const keyPair = ECPair.fromWIF(fromWIF, network)
    const pubkey = Buffer.from(keyPair.publicKey)

    const payment =
        fromType === 'p2wpkh' ? bitcoin.payments.p2wpkh({pubkey, network}) : bitcoin.payments.p2pkh({pubkey, network})

    const fromAddress = payment.address!
    const utxos: UTXO[] = await getUtxos(fromAddress)

    if (!utxos.length) {
        console.log('No UTXOs available for', fromAddress)
        return
    }

    const fee = 2000
    const totalInput = utxos.reduce((sum, utxo) => sum + utxo.value, 0)

    if (totalInput < amountSats + fee) {
        console.error('Insufficient balance.')
        return
    }

    const psbt = new bitcoin.Psbt({network})

    for (const utxo of utxos) {
        const rawTxHex = (await axios.get(`${API_BASE}/tx/${utxo.txid}/hex`)).data

        if (fromType === 'p2wpkh') {
            const scriptPubKey = bitcoin.payments.p2wpkh({pubkey, network}).output!
            psbt.addInput({
                hash: utxo.txid,
                index: utxo.vout,
                witnessUtxo: {
                    script: scriptPubKey,
                    value: utxo.value
                }
            })
        } else {
            psbt.addInput({
                hash: utxo.txid,
                index: utxo.vout,
                nonWitnessUtxo: Buffer.from(rawTxHex, 'hex')
            })
        }
    }

    psbt.addOutput({
        address: toAddress,
        value: amountSats
    })

    const change = totalInput - amountSats - fee
    if (change > 0) {
        psbt.addOutput({
            address: fromAddress,
            value: change
        })
    }

    utxos.forEach((_, idx) => {
        psbt.signInput(idx, {
            publicKey: pubkey,
            sign: (hash) => Buffer.from(keyPair.sign(hash))
        })
    })

    psbt.finalizeAllInputs()
    const txHex = psbt.extractTransaction().toHex()
    const txid = await broadcastTx(txHex)
    console.log('Broadcasted TXID:', txid)
}

async function verifyHTLCScriptHashFromTx(txid: string, htlcScript: Buffer): Promise<void> {
    const scriptHash = bitcoin.crypto.hash160(htlcScript) // HASH160(redeemScript)

    // Fetch raw tx and decode
    const txHex = await fetchWithRetry(() => axios.get(`${API_BASE}/tx/${txid}/hex`).then((res) => res.data))

    const tx = bitcoin.Transaction.fromHex(txHex)

    // Get expected scriptPubKey from known redeem script
    const expectedOutputScript = bitcoin.script.compile([
        bitcoin.opcodes.OP_HASH160,
        scriptHash,
        bitcoin.opcodes.OP_EQUAL
    ])

    // Check if any output matches
    const match = tx.outs.find((out) => out.script.equals(expectedOutputScript))

    if (match) {
        console.log('✅ HTLC script hash verified on-chain!')
    } else {
        console.error('❌ HTLC script hash mismatch. Script may not be correct.')
    }

    // Optional: debug print
    console.log('Expected scriptPubKey:', expectedOutputScript.toString('hex'))
    tx.outs.forEach((out, i) => {
        console.log(`Output ${i} scriptPubKey: ${out.script.toString('hex')}`)
    })
}

async function processWhenTakerAssetIsBTC(): Promise<void> {
    // ========================================
    // 1️⃣ PHASE 1: Taker (resolver) creates HTLC and deposits BTC
    // ========================================
    console.log('🔐 Phase 1: Taker locking BTC into HTLC...')

    // NOTE: secret is known to the maker — taker only knows the hash
    const secretHash = bitcoin.crypto.sha256(
        Buffer.from('c06c1486fc3ebbf5b4ce0b12a6ca10f38f7a738c3de082946112b1fb68d7fe96', 'hex')
    )

    const lockTime = 2640000 // Timeout block (taker can refund after this)

    const textBuffer = Buffer.from('hello world', 'utf8')

    const htlcScript = bitcoin.script.compile([
        textBuffer,
        bitcoin.opcodes.OP_DROP,

        bitcoin.opcodes.OP_IF,
        bitcoin.opcodes.OP_SHA256,
        secretHash,
        bitcoin.opcodes.OP_EQUALVERIFY,
        pubKeyA, // 👤 Maker can claim with secret
        bitcoin.opcodes.OP_CHECKSIG,
        bitcoin.opcodes.OP_ELSE,
        bitcoin.script.number.encode(lockTime),
        bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY,
        bitcoin.opcodes.OP_DROP,
        pubKeyB, // 👤 Taker can refund after timeout
        bitcoin.opcodes.OP_CHECKSIG,
        bitcoin.opcodes.OP_ENDIF
    ])

    const p2sh = bitcoin.payments.p2sh({
        redeem: {output: htlcScript, network},
        network
    })

    console.log('✅ HTLC P2SH Address:', p2sh.address)

    // === Taker (resolver) funds the HTLC ===
    const utxos = await getUtxos(resolverBech32Address!)
    if (!utxos.length) {
        console.error('❌ No UTXOs available to fund HTLC.')
        return
    }

    const amount = 5000 // Match maker's amount or adjust as needed
    const fee = 1000
    const totalInput = utxos.reduce((sum, u) => sum + u.value, 0)
    const change = totalInput - amount - fee

    if (change < 0) {
        console.error('❌ Not enough funds to lock BTC and cover the fee.')
        return
    }

    const psbt = new bitcoin.Psbt({network})

    for (const utxo of utxos) {
        psbt.addInput({
            hash: utxo.txid,
            index: utxo.vout,
            witnessUtxo: {
                script: bitcoin.payments.p2wpkh({pubkey: pubKeyB, network}).output!,
                value: utxo.value
            }
        })
    }

    psbt.addOutput({
        script: p2sh.output!,
        value: amount
    })

    if (change > 0) {
        psbt.addOutput({
            address: resolverBech32Address!, // refund to self
            value: change
        })
    }

    utxos.forEach((_, idx) => {
        psbt.signInput(idx, {
            publicKey: pubKeyB,
            sign: (hash) => Buffer.from(keyPairB.sign(hash))
        })
    })

    psbt.finalizeAllInputs()

    const txHex = psbt.extractTransaction().toHex()
    const txid = await broadcastTx(txHex)

    console.log('✅ Taker has funded HTLC:')
    console.log('🔗 TXID:', txid)

    await verifyHTLCScriptHashFromTx(txid, htlcScript)
    await waitForTxConfirmation(txid)

    // ========================================
    // 2️⃣ PHASE 2: Maker claims BTC using secret
    // ========================================
    console.log('\n🔓 Phase 2: Maker (user) claims HTLC using secret...')

    const htlcUtxos = await waitForUtxo(p2sh.address!)
    if (!htlcUtxos.length) {
        console.error('❌ No UTXOs in HTLC address.')
        return
    }

    const htlcUtxo = htlcUtxos[0]
    const spendPsbt = new bitcoin.Psbt({network})

    const rawTxHex = await fetchWithRetry(() =>
        axios.get(`${API_BASE}/tx/${htlcUtxo.txid}/hex`).then((res) => res.data)
    )

    spendPsbt.addInput({
        hash: htlcUtxo.txid,
        index: htlcUtxo.vout,
        nonWitnessUtxo: Buffer.from(rawTxHex, 'hex'),
        redeemScript: htlcScript
    })

    const redeemFee = 1000
    const redeemValue = htlcUtxo.value - redeemFee

    if (redeemValue <= 0) {
        console.error(`❌ Not enough value to redeem HTLC.`)
        return
    }

    spendPsbt.addOutput({
        address: userBech32Address!,
        value: redeemValue
    })

    const secret = Buffer.from('c06c1486fc3ebbf5b4ce0b12a6ca10f38f7a738c3de082946112b1fb68d7fe96', 'hex')

    spendPsbt.signInput(0, {
        publicKey: pubKeyA,
        sign: (hash) => Buffer.from(keyPairA.sign(hash))
    })

    const htlcRedeemFinalizer = (inputIndex: number, input: any) => {
        const signature = input.partialSig[0].signature

        const unlockingScript = bitcoin.script.compile([signature, secret, bitcoin.opcodes.OP_TRUE])

        const payment = bitcoin.payments.p2sh({
            redeem: {
                input: unlockingScript,
                output: htlcScript
            }
        })

        return {
            finalScriptSig: payment.input,
            finalScriptWitness: undefined
        }
    }

    spendPsbt.finalizeInput(0, htlcRedeemFinalizer)

    const finalTxHex = spendPsbt.extractTransaction().toHex()
    const finalTxId = await broadcastTx(finalTxHex)

    console.log('🎉 Maker successfully claimed BTC from HTLC!')
    console.log('✅ Redemption TXID:', finalTxId)
}

async function processWhenMakerAssetIsBTC(): Promise<void> {
    // ========================================
    // 1️⃣ PHASE 1: Maker creates HTLC and fully signs TX
    // ========================================
    console.log('🔐 Phase 1: Maker creating HTLC and signed funding TX...')

    const secret = crypto.randomBytes(32)
    const hash = bitcoin.crypto.sha256(secret)

    const lockTime = 2640000

    const htlcScript = bitcoin.script.compile([
        bitcoin.opcodes.OP_IF,
        bitcoin.opcodes.OP_SHA256,
        hash,
        bitcoin.opcodes.OP_EQUALVERIFY,
        pubKeyB,
        bitcoin.opcodes.OP_CHECKSIG,
        bitcoin.opcodes.OP_ELSE,
        bitcoin.script.number.encode(lockTime),
        bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY,
        bitcoin.opcodes.OP_DROP,
        pubKeyA,
        bitcoin.opcodes.OP_CHECKSIG,
        bitcoin.opcodes.OP_ENDIF
    ])

    const p2sh = bitcoin.payments.p2sh({
        redeem: {output: htlcScript, network},
        network
    })

    console.log('✅ HTLC P2SH Address:', p2sh.address)

    // 👤 Maker's P2WPKH funding
    const makerPayment = bitcoin.payments.p2wpkh({
        pubkey: pubKeyA,
        network
    })

    const fromAddress = makerPayment.address!
    console.log('🔗 Maker Funding Address:', fromAddress)

    const utxos = await getUtxos(fromAddress)
    if (!utxos.length) {
        console.error("❌ No UTXOs found in maker's wallet.")
        return
    }

    const amount = 5000
    const fee = 1000
    const totalInput = utxos.reduce((sum, utxo) => sum + utxo.value, 0)
    const change = totalInput - amount - fee

    if (change < 0) {
        console.error('❌ Not enough funds to lock 10 sats and cover the fee.')
        return
    }

    const psbt = new bitcoin.Psbt({network})

    if (change > 0) {
        psbt.addOutput({
            address: fromAddress,
            value: change
        })
    }

    for (const utxo of utxos) {
        psbt.addInput({
            hash: utxo.txid,
            index: utxo.vout,
            witnessUtxo: {
                script: makerPayment.output!,
                value: utxo.value
            }
        })
    }

    psbt.addOutput({
        script: p2sh.output!,
        value: amount
    })

    utxos.forEach((_, idx) => {
        psbt.signInput(idx, {
            publicKey: pubKeyA,
            sign: (hash) => Buffer.from(keyPairA.sign(hash))
        })
    })

    psbt.finalizeAllInputs()

    const txHex = psbt.extractTransaction().toHex()

    // 💾 Save fully signed TX and order details
    const order = {
        txHex,
        htlcScriptHex: htlcScript.toString('hex'),
        p2shAddress: p2sh.address!,
        valueSats: amount,
        lockTime,
        hash: hash.toString('hex'),
        createdAt: new Date().toISOString()
    }

    const orderJson = JSON.stringify(order, null, 2)
    console.log('📦 Maker created and signed order JSON:\n', orderJson)

    // ========================================
    // 2️⃣ PHASE 2: Taker receives order, broadcasts
    // ========================================
    console.log('\n📥 Phase 2: Resolver receives signed TX and broadcasts...')

    const loaded = JSON.parse(orderJson)

    console.log('HTLC address:', loaded.p2shAddress)

    const txid = await broadcastTx(loaded.txHex)
    console.log('✅ HTLC Funding TX Broadcasted:', txid)

    await verifyHTLCScriptHashFromTx(txid, htlcScript)
    await waitForTxConfirmation(txid)

    // ========================================
    // 3️⃣ PHASE 3: Resolver redeems HTLC using secret
    // ========================================
    console.log('\n🔓 Phase 3: Resolver redeems HTLC with secret...')

    const htlcUtxos = await waitForUtxo(loaded.p2shAddress)
    if (!htlcUtxos.length) {
        console.error('❌ No UTXOs found at HTLC address.')
        return
    }

    const htlcScriptBuffer = Buffer.from(loaded.htlcScriptHex, 'hex')
    const htlcUtxo = htlcUtxos[0]

    const rawTxHex = await fetchWithRetry(() =>
        axios.get(`${API_BASE}/tx/${htlcUtxo.txid}/hex`).then((res) => res.data)
    )

    const spendPsbt = new bitcoin.Psbt({network})

    spendPsbt.addInput({
        hash: htlcUtxo.txid,
        index: htlcUtxo.vout,
        nonWitnessUtxo: Buffer.from(rawTxHex, 'hex'),
        redeemScript: htlcScriptBuffer
    })

    const redeemFee = 1000
    const redeemValue = htlcUtxo.value - redeemFee

    if (redeemValue <= 0) {
        console.error(`❌ Not enough value to redeem HTLC. UTXO value = ${htlcUtxo.value}, fee = ${redeemFee}`)
        return
    }

    spendPsbt.addOutput({
        address: resolverBech32Address!,
        value: redeemValue
    })

    // Sign the input. This generates the signature and stores it in the PSBT.
    spendPsbt.signInput(0, {
        publicKey: Buffer.from(keyPairB.publicKey),
        sign: (hash) => Buffer.from(keyPairB.sign(hash))
    })

    // This custom finalizer function assembles the correct scriptSig.
    const htlcRedeemFinalizer = (inputIndex: number, input: any) => {
        const signature = input.partialSig[0].signature

        // This is the "unlocking" script. It provides the data needed
        // to satisfy the OP_IF branch of your HTLC redeem script.
        // It must contain, in order: signature, secret, and OP_TRUE.
        const unlockingScript = bitcoin.script.compile([
            signature,
            secret, // The secret must be a Buffer
            bitcoin.opcodes.OP_TRUE
        ])

        // Use the payments utility to create the final scriptSig, which correctly
        // combines the unlocking data with the redeem script itself.
        const payment = bitcoin.payments.p2sh({
            redeem: {
                input: unlockingScript,
                output: input.redeemScript
            }
        })

        return {
            finalScriptSig: payment.input,
            finalScriptWitness: undefined
        }
    }

    // Finalize the input using our custom logic.
    spendPsbt.finalizeInput(0, htlcRedeemFinalizer)

    // Extract and broadcast the final, valid transaction.
    const finalTxHex = spendPsbt.extractTransaction().toHex()
    const finalTxId = await broadcastTx(finalTxHex)

    console.log('🎉 Resolver has claimed the HTLC!')
    console.log('✅ Final Redeem TXID:', finalTxId)
}

// Example usage
async function main() {
    console.log('After funding, fetch the UTXO and construct redeem/refund tx.\n')

    const format = (sats: number) => (sats / 1e8).toFixed(8)

    const userP2PKHBalance = await getBalance(userLegacyAddress!)
    const userP2WPKHBalance = await getBalance(userBech32Address!)
    const resolverP2PKHBalance = await getBalance(resolverLegacyAddress!)
    const resolverP2WPKHBalance = await getBalance(resolverBech32Address!)
    //
    console.log(`Balance (User P2PKH): ${format(userP2PKHBalance)} tBTC`)
    console.log(`Balance (User P2WPKH): ${format(userP2WPKHBalance)} tBTC`)
    console.log(`Balance (Resolver P2PKH): ${format(resolverP2PKHBalance)} tBTC`)
    console.log(`Balance (Resolver P2WPKH): ${format(resolverP2WPKHBalance)} tBTC`)

    // await processWhenTakerAssetIsBTC();
    // await processWhenMakerAssetIsBTC();

    // await sendBitcoin({
    //     fromWIF: privKeyA,
    //     toAddress: userBech32Address!,
    //     amountSats: 100000,
    //     fromType: 'p2pkh'
    // })
}

main().catch(console.error)
