import {execSync} from 'child_process'
import {BITCOIN_CLI} from './test-utils/btc'
import {expect, jest} from '@jest/globals'
import Sdk from '@1inch/cross-chain-sdk'
import * as bitcoin from 'bitcoinjs-lib'

import {randomBytes} from 'crypto'
import {Chain} from './test-utils/evm'
import {Wallet} from '../sdk/evm/wallet'
import {EscrowFactory} from '../sdk/evm/escrow-factory'
import {getBalances as evmGetBalances, increaseTime, initChain} from './test-utils/evm'

import {evmOwnerPk, evmResolverPk, evmUserPk} from './test-utils/evm'
import {parseUnits} from 'ethers'
import {uint8ArrayToHex, UINT_40_MAX} from '@1inch/byte-utils'
import {Resolver} from '../sdk/evm/resolver'
import {getOrderHashWithPatch, patchedDomain} from '../sdk/evm/patch'
import {setDeployedAt} from '../sdk/evm/timelocks'
import bip68 from 'bip68'
import {walletFromWIF, addressToEthAddressFormat, createDstHtlcScript, createSrcHtlcScript} from '../sdk/btc'

import {BtcProvider} from '../sdk/btc'

const {Address} = Sdk

jest.setTimeout(1000 * 60)

// default addresses
const btcUserPk = 'cP7YndPTRomiUQEDfm3zFCMpNgBYyPZLJ84LoB4dZ73NzqJSny4n'
const btcResolverPk = 'cUJ4wz3dLzT8v2ZxKtRpU7qyXZ6E1qur87LGCGMehYTkWHnQTMeD'

const nativeTokenAddress = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
const nullAddress = '0x0000000000000000000000000000000000000000'

describe('btc', () => {
    const network = bitcoin.networks.regtest
    const btcProvider = new BtcProvider('http://localhost:8094/regtest/api')

    const btcUser = walletFromWIF(btcUserPk, network)
    const btcResolver = walletFromWIF(btcResolverPk, network)

    console.log('btcUser.address', btcUser.address)
    console.log('btcResolver.address', btcResolver.address)

    const evmChainId = 1
    const dummyBtcChainId = 137 // set dummy value this first
    const btcChainId = 99999 // just random chain id for now

    let evm: Chain

    let evmUser: Wallet
    let evmResolver: Wallet
    let evmFactory: EscrowFactory
    let evmResolverContract: Wallet

    let evmTimestamp: bigint
    let btcTimestamp: bigint
    let btcMiningAddress: string

    beforeAll(async () => {
        console.log('🚀 Set up EVM...')
        ;[evm] = await Promise.all([initChain(evmChainId, evmOwnerPk, evmResolverPk)])

        evmTimestamp = BigInt((await evm.provider.getBlock('latest'))!.timestamp)

        evmUser = new Wallet(evmUserPk, evm.provider)
        evmResolver = new Wallet(evmResolverPk, evm.provider)

        evmFactory = new EscrowFactory(evm.provider, evm.escrowFactory)

        await evmUser.deposit(evm.weth, parseUnits('0.001', 18))
        await evmUser.unlimitedApprove(evm.weth, evm.lop)

        evmResolverContract = await Wallet.fromAddress(evm.resolver, evm.provider)

        await evmResolver.send({to: evmResolverContract, value: parseUnits('0.01', 18)})
        await evmResolverContract.deposit(evm.weth, parseUnits('0.001', 18))
        await evmResolverContract.unlimitedApprove(evm.weth, evm.escrowFactory)

        console.log('✅ Evm ready.')

        console.log('🚀 Starting Esplora Docker container...')

        btcTimestamp = evmTimestamp
        console.log('btcTimestamp', btcTimestamp)

        execSync(
            `docker run --name esplora -p 50001:50001 -p 8094:80 --rm -d blockstream/esplora bash -c "/srv/explorer/run.sh bitcoin-regtest explorer"`,
            {stdio: 'inherit'}
        )

        console.log('⏳ Waiting for Bitcoin node to be ready...')
        execSync(`sleep 5`)

        console.log('⛏️  Mining and sending funds...')

        execSync(`${BITCOIN_CLI} createwallet mining_address`)

        btcMiningAddress = execSync(`${BITCOIN_CLI} -rpcwallet=mining_address getnewaddress`).toString().trim()

        // execSync(`${BITCOIN_CLI} setmocktime ${btcTimestamp}`)
        execSync(`${BITCOIN_CLI} -rpcwallet=mining_address generatetoaddress 101 ${btcMiningAddress}`)
        execSync(`sleep 5`)

        const testAddresses = [btcUser.address, btcResolver.address]

        testAddresses.forEach((addr) => {
            execSync(`${BITCOIN_CLI} -rpcwallet=mining_address sendtoaddress ${addr} 1`)
        })
        execSync(`${BITCOIN_CLI} -rpcwallet=mining_address generatetoaddress 2 ${btcMiningAddress}`)
        execSync(`sleep 2`)

        console.log('✅ Bitcoin regtest ready.')
    })

    afterAll(async () => {
        try {
            console.log('🧹 Stopping Esplora Docker container...')
            execSync('docker stop esplora', {stdio: 'inherit'})
        } catch (err) {
            console.warn('⚠️ Could not stop esplora container — it may have already stopped.')
        }
        evm.provider.destroy()
        await evm.node?.stop()
    })

    describe('evm -> btc', () => {
        it('should work', async () => {
            console.log('\n========== 🛠️ Phase 1: CREATE ORDER ==========')

            console.log('🔹 User makes order')

            const evmInitialBalances = await evmGetBalances([
                {token: evm.weth, user: evmUser, resolver: evmResolverContract}
            ])

            const btcUserInitialBalance = await btcProvider.getBalance(btcUser.address!)
            const btcResolverInitialBalance = await btcProvider.getBalance(btcResolver.address!)

            const secret = randomBytes(32)
            const hashLock = {
                keccak256: Sdk.HashLock.forSingleFill(uint8ArrayToHex(secret)),
                sha256: bitcoin.crypto.sha256(secret)
            }

            const order = Sdk.CrossChainOrder.new(
                new Address(evm.escrowFactory),
                {
                    salt: Sdk.randBigInt(1000n),
                    maker: new Address(await evmUser.getAddress()),
                    makingAmount: 10000n,
                    takingAmount: 9999n,
                    makerAsset: new Address(evm.weth),
                    takerAsset: new Address(nativeTokenAddress)
                },
                {
                    hashLock: hashLock.keccak256,
                    timeLocks: Sdk.TimeLocks.new({
                        srcWithdrawal: 10n, // 10sec finality lock for test
                        srcPublicWithdrawal: 120n, // 2m for private withdrawal
                        srcCancellation: 121n, // 1sec public withdrawal
                        srcPublicCancellation: 122n, // 1sec private cancellation
                        dstWithdrawal: 10n, // 10sec finality lock for test
                        dstPublicWithdrawal: 100n, // 100sec private withdrawal
                        dstCancellation: 101n // 1sec public withdrawal
                    }),
                    srcChainId: evmChainId,
                    dstChainId: dummyBtcChainId,
                    srcSafetyDeposit: 1n,
                    dstSafetyDeposit: 0n
                },
                {
                    auction: new Sdk.AuctionDetails({
                        initialRateBump: 0,
                        points: [],
                        duration: 120n,
                        startTime: evmTimestamp
                    }),
                    whitelist: [
                        {
                            address: new Address(evm.resolver),
                            allowFrom: 0n
                        }
                    ],
                    resolvingStartTime: 0n
                },
                {
                    nonce: Sdk.randBigInt(UINT_40_MAX),
                    allowPartialFills: false,
                    allowMultipleFills: false
                }
            )

            // patch
            // @ts-ignore
            order.inner.inner.takerAsset = new Address(evm.trueERC20)
            // @ts-ignore
            order.inner.inner.receiver = addressToEthAddressFormat(btcUser.address!)
            // @ts-ignore
            order.inner.fusionExtension.dstChainId = btcChainId

            const signature = await evmUser.signOrder(evmChainId, order, evm.lop)
            const orderHash = getOrderHashWithPatch(evmChainId, order, {...patchedDomain, verifyingContract: evm.lop})

            console.log('✅ Order created with hash:', orderHash)

            console.log('\n========== 🏗️ Phase 2: CREATE ESCROW ==========')
            console.log('🔹 Resolver creates escrows on source chain (ETH)')

            const resolverContract = new Resolver(evm.resolver, evm.resolver)
            const fillAmount = order.makingAmount
            console.log(`[${evmChainId}] 🧾 Filling order ${orderHash} with amount ${fillAmount}`)

            const {txHash: orderFillHash, blockNumber: srcDeployBlockNumber} = await evmResolver.send(
                resolverContract.deploySrc(
                    evmChainId,
                    evm.lop,
                    order,
                    signature,
                    Sdk.TakerTraits.default()
                        .setExtension(order.extension)
                        .setAmountMode(Sdk.AmountMode.maker)
                        .setAmountThreshold(order.takingAmount),
                    fillAmount
                )
            )
            console.log(`[${evmChainId}] ✅ Order filled in tx ${orderFillHash}`)

            const srcEscrowEvent = await evmFactory.getSrcDeployEvent(srcDeployBlockNumber)
            const dstImmutables = srcEscrowEvent[0]
                .withComplement(srcEscrowEvent[1])
                .withTaker(new Address(resolverContract.dstAddress))

            const rebuiltAddress = bitcoin.address.toBech32(
                Buffer.from(dstImmutables.maker.toString().slice(2), 'hex'),
                0,
                network.bech32
            )
            expect(rebuiltAddress).toBe(btcUser.address)

            console.log('🔹 Preparing destination chain (BTC) HTLC script')

            const dstTimeLocks = dstImmutables.timeLocks.toDstTimeLocks()
            const htlcScript = createDstHtlcScript(
                orderHash,
                hashLock.sha256,
                dstTimeLocks.privateWithdrawal,
                dstTimeLocks.privateCancellation,
                btcUser.publicKey,
                btcResolver.publicKey
            )

            const p2sh = bitcoin.payments.p2sh({
                redeem: {output: htlcScript, network},
                network
            })

            console.log('✅ HTLC P2SH Address:', p2sh.address)

            const utxos = await btcProvider.getUtxos(btcResolver.address!)
            if (!utxos.length) {
                console.error('❌ No UTXOs available to fund HTLC.')
                return
            }

            const amount = Number(order.takingAmount)
            const fee = 10000
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
                        script: bitcoin.payments.p2wpkh({pubkey: btcResolver.publicKey, network}).output!,
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
                    address: btcResolver.address!, // refund to self
                    value: change
                })
            }

            utxos.forEach((_, idx) => {
                psbt.signInput(idx, {
                    publicKey: btcResolver.publicKey,
                    sign: (hash) => Buffer.from(btcResolver.keyPair.sign(hash))
                })
            })

            psbt.finalizeAllInputs()

            const txHex = psbt.extractTransaction().toHex()
            const btcDstEscrowHash = await btcProvider.broadcastTx(txHex)

            console.log('✅ HTLC funded on BTC chain')
            console.log('🔗 btcDstEscrowHash:', btcDstEscrowHash)

            console.log('\n========== 💸 Phase 3: WITHDRAW ==========')
            console.log('🔹 User (Maker) withdraws BTC from HTLC on destination (Bitcoin) chain')

            // Ensure HTLC on BTC chain is valid
            await btcProvider.verifyHTLCScriptHashFromTx(btcDstEscrowHash, htlcScript)

            // Simulate time passage to enable locktime
            await increaseTime([evm], 11)

            // Prepare Bitcoin HTLC redeem transaction
            const spendPsbt = new bitcoin.Psbt({network})
            const rawTxHex = await btcProvider.getRawTransactionHex(btcDstEscrowHash)

            spendPsbt.setLocktime(Number(dstTimeLocks.privateWithdrawal))
            spendPsbt.addInput({
                hash: btcDstEscrowHash,
                index: 0,
                nonWitnessUtxo: Buffer.from(rawTxHex, 'hex'),
                redeemScript: htlcScript,
                sequence: 0xfffffffe // Enable locktime
            })

            const redeemFee = 1000
            const redeemValue = amount - redeemFee

            if (redeemValue <= 0) {
                console.error(`❌ Not enough value to redeem HTLC.`)
                return
            }

            // Send BTC to the user (maker)
            spendPsbt.addOutput({
                address: btcUser.address!,
                value: redeemValue
            })

            // User signs the input to claim funds
            spendPsbt.signInput(0, {
                publicKey: btcUser.publicKey,
                sign: (hash) => Buffer.from(btcUser.keyPair.sign(hash))
            })

            // Finalize the input with the unlocking script
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
            const finalTxId = await btcProvider.broadcastTx(finalTxHex)

            console.log('🎉 User (Maker) successfully claimed BTC from HTLC!')
            console.log('✅ BTC Redemption TXID:', finalTxId)

            console.log('\n🔹 Resolver (Taker) withdraws ETH from escrow on source (EVM) chain')

            const ESCROW_SRC_IMPLEMENTATION = await evmFactory.getSourceImpl()
            const evmSrcEscrowAddress = new Sdk.EscrowFactory(new Address(evm.escrowFactory)).getSrcEscrowAddress(
                srcEscrowEvent[0],
                ESCROW_SRC_IMPLEMENTATION
            )

            console.log(`[${evmChainId}] 🔓 Withdrawing from escrow: ${evmSrcEscrowAddress}`)

            const {txHash: resolverWithdrawHash} = await evmResolver.send(
                resolverContract.withdraw(
                    'src',
                    evmSrcEscrowAddress,
                    uint8ArrayToHex(secret),
                    srcEscrowEvent[0].build()
                )
            )

            console.log(`[${evmChainId}] ✅ ETH Withdrawal TXID: ${resolverWithdrawHash}`)

            // Check ETH balances after withdrawal
            const evmResultBalances = await evmGetBalances([
                {token: evm.weth, user: evmUser, resolver: evmResolverContract}
            ])

            expect(evmInitialBalances[0].user - evmResultBalances[0].user).toBe(order.makingAmount)
            expect(evmResultBalances[0].resolver - evmInitialBalances[0].resolver).toBe(order.makingAmount)

            // Check BTC balances after user withdrawal
            const btcUserResultBalance = await btcProvider.getBalance(btcUser.address!)
            const btcResolverResultBalance = await btcProvider.getBalance(btcResolver.address!)

            expect(btcUserResultBalance - btcUserInitialBalance).toBe(redeemValue)
            expect(btcResolverInitialBalance - btcResolverResultBalance).toBe(amount + fee)
        })
    })

    describe('btc -> evm', () => {
        it('should work', async () => {
            const evmInitialBalances = await evmGetBalances([
                {token: evm.weth, user: evmUser, resolver: evmResolverContract}
            ])
            const btcUserInitialBalance = await btcProvider.getBalance(btcUser.address!)
            const btcResolverInitialBalance = await btcProvider.getBalance(btcResolver.address!)

            console.log('\n========== 🛠️ Phase 1: CREATE ORDER ==========')
            console.log('🔹 User creates and funds an HTLC on the source chain (BTC)')

            const secret = randomBytes(32)

            const hashLock = {
                keccak256: Sdk.HashLock.forSingleFill(uint8ArrayToHex(secret)),
                sha256: bitcoin.crypto.sha256(secret)
            }

            const lockInSeconds = 512 // Your desired lock time

            // use sdk to make order object
            const order = Sdk.CrossChainOrder.new(
                new Address(nullAddress),
                {
                    salt: Sdk.randBigInt(1000n),
                    maker: new Address(addressToEthAddressFormat(btcUser.address!)),
                    makingAmount: 10000n,
                    takingAmount: 9999n,
                    makerAsset: new Address(nullAddress), // ths is dummy now
                    takerAsset: new Address(evm.weth),
                    receiver: new Address(await evmUser.getAddress())
                },
                {
                    hashLock: hashLock.keccak256,
                    timeLocks: Sdk.TimeLocks.new({
                        srcWithdrawal: BigInt(lockInSeconds), // about 1 blocks, must be 512, 1024, 1536...
                        srcPublicWithdrawal: 1535n, // not used
                        srcCancellation: 1536n, // about 2 blocks, must be 512, 1024, 1536...
                        srcPublicCancellation: 1537n, // not used
                        dstWithdrawal: BigInt(lockInSeconds), // adjust with btc
                        dstPublicWithdrawal: 1024n, // 100sec private withdrawal
                        dstCancellation: 1025n // 1sec public withdrawal
                    }),
                    srcChainId: dummyBtcChainId,
                    dstChainId: evmChainId,
                    srcSafetyDeposit: 0n,
                    dstSafetyDeposit: 1n
                },
                {
                    auction: new Sdk.AuctionDetails({
                        initialRateBump: 0,
                        points: [],
                        duration: 120n,
                        startTime: btcTimestamp
                    }),
                    whitelist: [
                        {
                            address: new Address(nullAddress),
                            allowFrom: 0n
                        }
                    ],
                    resolvingStartTime: 0n
                },
                {
                    nonce: Sdk.randBigInt(UINT_40_MAX),
                    allowPartialFills: false,
                    allowMultipleFills: false
                }
            )

            // @ts-ignore
            order.inner.fusionExtension.srcChainId = btcChainId

            const orderHash = getOrderHashWithPatch(btcChainId, order, {
                name: '',
                version: '',
                verifyingContract: nullAddress
            })
            // @ts-ignore
            const timeLocks = order.inner.fusionExtension.timeLocks
            const sequenceValue = bip68.encode({seconds: lockInSeconds, blocks: undefined})
            const htlcScript = createSrcHtlcScript(
                orderHash,
                hashLock.sha256,
                timeLocks._srcWithdrawal,
                timeLocks._srcCancellation,
                btcUser.publicKey,
                btcResolver.publicKey,
                false
            )

            const p2sh = bitcoin.payments.p2sh({
                redeem: {output: htlcScript, network},
                network
            })

            console.log('🧾 HTLC P2SH Address:', p2sh.address)

            // 👤 Maker's P2WPKH funding
            const makerPayment = bitcoin.payments.p2wpkh({
                pubkey: btcUser.publicKey,
                network
            })

            const fromAddress = makerPayment.address!

            const utxos = await btcProvider.getUtxos(fromAddress)
            if (!utxos.length) {
                console.error("❌ No UTXOs found in maker's wallet.")
                return
            }

            const amount = Number(order.makingAmount)
            const fee = 10000
            const totalInput = utxos.reduce((sum, utxo) => sum + utxo.value, 0)
            const change = totalInput - amount - fee

            if (change < 0) {
                console.error('❌ Not enough funds to lock BTC and cover the fee.')
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
                    publicKey: btcUser.publicKey,
                    sign: (hash) => Buffer.from(btcUser.keyPair.sign(hash))
                })
            })

            psbt.finalizeAllInputs()

            const txHex = psbt.extractTransaction().toHex()

            const btcOrder = {
                txHex,
                htlcScriptHex: htlcScript.toString('hex'),
                p2shAddress: p2sh.address!
            }

            const orderJson = JSON.stringify(btcOrder, null, 2)
            console.log('📦 Maker created and signed order transaction:\n', orderJson)
            console.log('✅ Order created and funded on BTC by the user')

            console.log('\n========== 🏗️ Phase 2: CREATE ESCROW ==========')
            console.log(
                '🔹 Resolver broadcasts the funding transaction and creates an escrow on the destination chain (EVM)'
            )

            const loaded = JSON.parse(orderJson)

            const txid = await btcProvider.broadcastTx(loaded.txHex)
            console.log('🔗 Broadcasting BTC funding TX:', txid)

            console.log('⛏️ Mining a block to confirm the funding transaction...')
            execSync(`${BITCOIN_CLI} -rpcwallet=mining_address generatetoaddress 1 ${btcMiningAddress}`)
            execSync('sleep 2')

            const {confirmedAt} = await btcProvider.waitForTxConfirmation(txid)
            console.log('⏱️ Confirmed BTC HTLC funding time:', confirmedAt)

            const srcEscrowEvent = [
                Sdk.Immutables.new({
                    orderHash: orderHash,
                    hashLock: hashLock.keccak256,
                    maker: order.maker,
                    taker: new Address(`0x${bitcoin.address.fromBech32(btcResolver.address!).data.toString('hex')}`),
                    token: order.makerAsset,
                    amount: order.makingAmount,
                    // @ts-ignore
                    safetyDeposit: order.inner.fusionExtension.srcSafetyDeposit,
                    timeLocks: Sdk.TimeLocks.fromBigInt(setDeployedAt(timeLocks.build(), BigInt(confirmedAt)))
                }),
                Sdk.DstImmutablesComplement.new({
                    maker: order.receiver,
                    amount: order.takingAmount,
                    token: new Address(evm.weth),
                    // @ts-ignore
                    safetyDeposit: order.inner.fusionExtension.dstSafetyDeposit
                })
            ] as [Sdk.Immutables, Sdk.DstImmutablesComplement]

            const dstImmutables = srcEscrowEvent[0]
                .withComplement(srcEscrowEvent[1])
                .withTaker(new Sdk.Address(await evmResolverContract.getAddress()))

            const resolverContract = new Resolver(evm.resolver, evm.resolver)
            console.log(`[${evmChainId}] 🧾 Filling order ${orderHash} by creating escrow on EVM`)
            const {txHash: dstDepositHash, blockTimestamp: dstDeployedAt} = await evmResolver.send(
                resolverContract.deployDst(dstImmutables)
            )
            console.log(`[${evmChainId}] ✅ Created EVM escrow for order ${orderHash} in tx ${dstDepositHash}`)

            console.log('\n========== 💸 Phase 3: WITHDRAW ==========')
            console.log('🔹 Resolver facilitates User (Maker) withdrawal from escrow on destination (EVM) chain')

            const latestBlockHeader = JSON.parse(
                execSync(`${BITCOIN_CLI} getblockheader $(${BITCOIN_CLI} getbestblockhash)`).toString().trim()
            )
            const newTime = latestBlockHeader.time + lockInSeconds + 100 // Add a buffer
            execSync(`${BITCOIN_CLI} setmocktime ${newTime}`)

            console.log('⛏️ Mining a final block to lock in the new time...')
            execSync(`${BITCOIN_CLI} -rpcwallet=mining_address generatetoaddress 10 ${btcMiningAddress}`)
            execSync('sleep 2')

            await btcProvider.verifyHTLCScriptHashFromTx(txid, htlcScript)
            const ESCROW_DST_IMPLEMENTATION = await evmFactory.getDestinationImpl()
            const dstEscrowAddress = new Sdk.EscrowFactory(new Address(evm.escrowFactory)).getDstEscrowAddress(
                srcEscrowEvent[0],
                srcEscrowEvent[1],
                dstDeployedAt,
                new Address(resolverContract.dstAddress),
                ESCROW_DST_IMPLEMENTATION
            )

            console.log(`[${evmChainId}] 🔓 Withdrawing from EVM escrow for user: ${dstEscrowAddress}`)

            await increaseTime([evm], 1000)

            const {txHash: userWithdrawHash} = await evmResolver.send(
                resolverContract.withdraw(
                    'dst',
                    dstEscrowAddress,
                    uint8ArrayToHex(secret),
                    dstImmutables.withDeployedAt(dstDeployedAt).build()
                )
            )
            console.log(`[${evmChainId}] ✅ ETH Withdrawal for User TXID: ${userWithdrawHash}`)

            console.log('\n🔹 Resolver (Taker) withdraws BTC from HTLC on source (Bitcoin) chain')

            const htlcUtxos = await btcProvider.getUtxos(loaded.p2shAddress)
            if (!htlcUtxos.length) {
                console.error('❌ No UTXOs found at HTLC address.')
                return
            }

            const htlcScriptBuffer = Buffer.from(loaded.htlcScriptHex, 'hex')
            const htlcUtxo = htlcUtxos[0]

            const rawTxHex = await btcProvider.getRawTransactionHex(htlcUtxo.txid)

            const spendPsbt = new bitcoin.Psbt({network})
            // spendPsbt.setVersion(2)
            spendPsbt.addInput({
                hash: htlcUtxo.txid,
                index: htlcUtxo.vout,
                nonWitnessUtxo: Buffer.from(rawTxHex, 'hex'),
                redeemScript: htlcScriptBuffer
                // sequence: sequenceValue
            })

            const redeemFee = 1000
            const redeemValue = htlcUtxo.value - redeemFee

            if (redeemValue <= 0) {
                console.error(`❌ Not enough value to redeem HTLC. UTXO value = ${htlcUtxo.value}, fee = ${redeemFee}`)
                return
            }

            spendPsbt.addOutput({
                address: btcResolver.address!,
                value: redeemValue
            })

            spendPsbt.signInput(0, {
                publicKey: Buffer.from(btcResolver.keyPair.publicKey),
                sign: (hash) => Buffer.from(btcResolver.keyPair.sign(hash))
            })

            const htlcRedeemFinalizer = (inputIndex: number, input: any) => {
                const signature = input.partialSig[0].signature
                const unlockingScript = bitcoin.script.compile([
                    signature,
                    secret, // The secret must be a Buffer
                    bitcoin.opcodes.OP_TRUE
                ])

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

            spendPsbt.finalizeInput(0, htlcRedeemFinalizer)

            const finalTxHex = spendPsbt.extractTransaction().toHex()
            const finalTxId = await btcProvider.broadcastTx(finalTxHex)

            console.log('🎉 Resolver has successfully claimed the BTC from the HTLC!')
            console.log('✅ Final Redeem TXID:', finalTxId)

            const evmResultBalances = await evmGetBalances([
                {token: evm.weth, user: evmUser, resolver: evmResolverContract}
            ])

            // User (receiver) should have received the taking amount
            expect(evmResultBalances[0].user - evmInitialBalances[0].user).toBe(order.takingAmount)
            // Resolver should have spent the taking amount
            expect(evmInitialBalances[0].resolver - evmResultBalances[0].resolver).toBe(order.takingAmount)
            console.log('✅ EVM balances are correct.')

            // Check BTC balances after withdrawal
            const btcUserResultBalance = await btcProvider.getBalance(btcUser.address!)
            const btcResolverResultBalance = await btcProvider.getBalance(btcResolver.address!)

            // BTC User (maker) should have spent the making amount + fee
            expect(btcUserInitialBalance - btcUserResultBalance).toBe(amount + fee)
            // BTC Resolver (taker) should have received the making amount - redeem fee
            expect(btcResolverResultBalance - btcResolverInitialBalance).toBe(redeemValue)
            console.log('✅ BTC balances are correct.')
        })
    })
})
