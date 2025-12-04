import {execSync} from 'child_process'
import {expect, jest} from '@jest/globals'
import Sdk from '@1inch/cross-chain-sdk'
import * as bitcoin from 'bitcoinjs-lib'
import {ECPairFactory} from 'ecpair'
import * as secp256k1 from '@bitcoinerlab/secp256k1'
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
import {ZecProvider, createZecSrcHtlcScript, createZecDstHtlcScript} from '../sdk/zcash'

const ECPair = ECPairFactory(secp256k1)
const {Address} = Sdk

jest.setTimeout(1000 * 60 * 5)

const ZCASH_CLI = 'docker exec zcashd-regtest zcash-cli -regtest -rpcuser=zcashuser -rpcpassword=zcashpass -rpcport=18332'

const nativeTokenAddress = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
const nullAddress = '0x0000000000000000000000000000000000000000'

describe('zec integration', () => {
    const network = bitcoin.networks.regtest
    const zecProvider = new ZecProvider({
        rpcUrl: 'http://localhost:18332',
        rpcUsername: 'zcashuser',
        rpcPassword: 'zcashpass'
    })

    let zecUser: any
    let zecResolver: any
    let zecUserAddress: string
    let zecResolverAddress: string

    const evmChainId = 1
    const dummyZecChainId = 137
    const zecChainId = 199998

    let evm: Chain
    let evmUser: Wallet
    let evmResolver: Wallet
    let evmFactory: EscrowFactory
    let evmResolverContract: Wallet

    let evmTimestamp: bigint
    let zecMiningAddress: string

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

        console.log('🚀 Setting up Zcash regtest...')

        console.log('⏳ Waiting for Zcash node to be ready...')
        execSync(`sleep 3`)

        console.log('⛏️  Mining and sending funds...')

        zecMiningAddress = execSync(`${ZCASH_CLI} getnewaddress`).toString().trim()

        execSync(`${ZCASH_CLI} generate 101`)
        execSync(`sleep 2`)

        const zecUserAddrFromNode = execSync(`${ZCASH_CLI} getnewaddress`).toString().trim()
        const zecResolverAddrFromNode = execSync(`${ZCASH_CLI} getnewaddress`).toString().trim()

        console.log('Using Zcash node addresses:')
        console.log('zecUserAddrFromNode:', zecUserAddrFromNode)
        console.log('zecResolverAddrFromNode:', zecResolverAddrFromNode)

        execSync(`${ZCASH_CLI} sendtoaddress ${zecUserAddrFromNode} 10`)
        execSync(`${ZCASH_CLI} sendtoaddress ${zecResolverAddrFromNode} 10`)
        execSync(`${ZCASH_CLI} generate 2`)
        execSync(`sleep 2`)

        zecUserAddress = zecUserAddrFromNode
        zecResolverAddress = zecResolverAddrFromNode

        zecUser = ECPair.makeRandom({network})
        zecResolver = ECPair.makeRandom({network})

        console.log('✅ Zcash regtest ready.')
    })

    afterAll(async () => {
        evm.provider.destroy()
        await evm.node?.stop()
    })

    describe('evm -> zec', () => {
        it('should work', async () => {
            console.log('\n========== 🛠️ Phase 1: CREATE ORDER ==========')

            console.log('🔹 User makes order')

            const evmInitialBalances = await evmGetBalances([
                {token: evm.weth, user: evmUser, resolver: evmResolverContract}
            ])
            const userAllowance = await evmUser.getAllowance(evm.weth, evm.lop)
            console.log('Initial WETH balances:', {
                user: evmInitialBalances[0].user.toString(),
                resolver: evmInitialBalances[0].resolver.toString()
            })
            console.log('User WETH allowance to LOP:', userAllowance.toString())

            const zecUserInitialBalance = await zecProvider.getBalance(zecUserAddress)
            const zecResolverInitialBalance = await zecProvider.getBalance(zecResolverAddress)

            const secret = randomBytes(32)
            const hashLock = {
                keccak256: Sdk.HashLock.forSingleFill(uint8ArrayToHex(secret)),
                sha256: bitcoin.crypto.sha256(secret)
            }

            const makingAmount = 10000n
            const takingAmount = 9999n

            const order = Sdk.CrossChainOrder.new(
                new Address(evm.escrowFactory),
                {
                    salt: Sdk.randBigInt(1000n),
                    maker: new Address(await evmUser.getAddress()),
                    makingAmount,
                    takingAmount,
                    makerAsset: new Address(evm.weth),
                    takerAsset: new Address(nativeTokenAddress)
                },
                {
                    hashLock: hashLock.keccak256,
                    timeLocks: Sdk.TimeLocks.new({
                        srcWithdrawal: 10n,
                        srcPublicWithdrawal: 120n,
                        srcCancellation: 121n,
                        srcPublicCancellation: 122n,
                        dstWithdrawal: 10n,
                        dstPublicWithdrawal: 100n,
                        dstCancellation: 101n
                    }),
                    srcChainId: evmChainId,
                    dstChainId: dummyZecChainId,
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
            // @ts-ignore
            console.log('Order maker address:', order.inner.inner.maker.toString())
            // @ts-ignore
            console.log('Order makerAsset address:', order.inner.inner.makerAsset.toString())

            // patch
            // @ts-ignore
            order.inner.inner.takerAsset = new Address(evm.trueERC20)
            
            const zecUserAddrInfo = JSON.parse(execSync(`${ZCASH_CLI} validateaddress ${zecUserAddress}`).toString().trim())
            const pubkey = Buffer.from(zecUserAddrInfo.pubkey, 'hex')
            const pubkeyHash = bitcoin.crypto.hash160(pubkey)
            const receiverAddress = `0x${pubkeyHash.toString('hex')}`
            console.log('Receiver address (hash160):', receiverAddress)
            
            // @ts-ignore
            order.inner.inner.receiver = new Address(receiverAddress)
            // @ts-ignore
            order.inner.fusionExtension.dstChainId = zecChainId

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
            console.log(`[${evmChainId}] ✅ Order filled in tx ${orderFillHash} (block ${srcDeployBlockNumber})`)

            const srcEscrowEvent = await evmFactory.getSrcDeployEvent(srcDeployBlockNumber)
            const dstImmutables = srcEscrowEvent[0]
                .withComplement(srcEscrowEvent[1])
                .withTaker(new Address(resolverContract.dstAddress))

            console.log('🔹 Preparing destination chain (ZEC) HTLC script')

            const dstTimeLocks = dstImmutables.timeLocks.toDstTimeLocks()
            const htlcScript = createZecDstHtlcScript(
                orderHash,
                hashLock.sha256,
                dstTimeLocks.privateWithdrawal,
                dstTimeLocks.privateCancellation,
                Buffer.from(zecUser.publicKey),
                Buffer.from(zecResolver.publicKey)
            )

            const p2sh = bitcoin.payments.p2sh({
                redeem: {output: htlcScript, network},
                network
            })

            console.log('✅ HTLC P2SH Address:', p2sh.address)

            const amount = Number(order.takingAmount) / 1e8

            const scriptHex = p2sh.output!.toString('hex')
            const scriptAddress = execSync(`${ZCASH_CLI} decodescript ${scriptHex}`).toString().trim()
            const scriptAddr = JSON.parse(scriptAddress).addresses[0]

            console.log('HTLC Script Address:', scriptAddr)

            execSync(`${ZCASH_CLI} sendtoaddress ${scriptAddr} ${amount}`)
            execSync(`${ZCASH_CLI} generate 1`)
            execSync(`sleep 2`)

            const utxos = await zecProvider.listUnspent(1, 9999999, [scriptAddr])
            if (!utxos.length) {
                console.error('❌ No UTXOs available at HTLC address.')
                return
            }

            const zecDstEscrowHash = utxos[0].txid

            console.log('✅ HTLC funded on ZEC chain')
            console.log('🔗 zecDstEscrowHash:', zecDstEscrowHash)

            console.log('\n========== 💸 Phase 3: WITHDRAW ==========')
            console.log('🔹 User (Maker) withdraws ZEC from HTLC on destination (Zcash) chain')

            await increaseTime([evm], 11)

            const htlcUtxo = utxos[0]
            const redeemAmount = amount - 0.00001

            const rawTx = await zecProvider.getRawTransaction(htlcUtxo.txid, true)
            const vout = rawTx.vout[htlcUtxo.vout]
            const prevoutScript = Buffer.from(vout.scriptPubKey.hex, 'hex')

            const psbt = new bitcoin.Psbt({network})
            psbt.setLocktime(Number(dstTimeLocks.privateWithdrawal))
            psbt.addInput({
                hash: htlcUtxo.txid,
                index: htlcUtxo.vout,
                nonWitnessUtxo: Buffer.from(await zecProvider.getRawTransaction(htlcUtxo.txid, false), 'hex'),
                redeemScript: htlcScript
            })

            psbt.addOutput({
                address: zecUserAddress,
                value: Math.floor(redeemAmount * 1e8)
            })

            psbt.signInput(0, {
                publicKey: Buffer.from(zecUser.publicKey),
                sign: (hash) => Buffer.from(zecUser.sign(hash))
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

            psbt.finalizeInput(0, htlcRedeemFinalizer)

            const finalTxHex = psbt.extractTransaction().toHex()
            const finalTxId = await zecProvider.sendRawTransaction(finalTxHex)

            console.log('🎉 User (Maker) successfully claimed ZEC from HTLC!')
            console.log('✅ ZEC Redemption TXID:', finalTxId)

            execSync(`${ZCASH_CLI} generate 1`)
            execSync(`sleep 2`)

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

            const evmResultBalances = await evmGetBalances([
                {token: evm.weth, user: evmUser, resolver: evmResolverContract}
            ])

            expect(evmInitialBalances[0].user - evmResultBalances[0].user).toBe(order.makingAmount)
            expect(evmResultBalances[0].resolver - evmInitialBalances[0].resolver).toBe(order.makingAmount)

            const zecUserResultBalance = await zecProvider.getBalance(zecUserAddress)
            const zecResolverResultBalance = await zecProvider.getBalance(zecResolverAddress)

            expect(zecUserResultBalance - zecUserInitialBalance).toBeGreaterThan(0)
            expect(zecResolverInitialBalance - zecResolverResultBalance).toBeGreaterThan(0)
        })
    })
})

