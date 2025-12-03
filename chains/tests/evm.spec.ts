import 'dotenv/config'
import {expect, jest} from '@jest/globals'

import Sdk from '../sdk/evm/cross-chain-sdk-shims'
import {parseUnits, randomBytes} from 'ethers'
import {BN, uint8ArrayToHex, UINT_40_MAX} from '@1inch/byte-utils'

import {Wallet} from '../sdk/evm/wallet'
import {Resolver} from '../sdk/evm/resolver'
import {EscrowFactory} from '../sdk/evm/escrow-factory'

import {getOrderHashWithPatch, patchedDomain} from '../sdk/evm/patch'
import {getBalances, initChain, increaseTime, evmOwnerPk, evmResolverPk, evmUserPk} from './test-utils/evm'
import {Chain} from './test-utils/evm'

const {Address} = Sdk

jest.setTimeout(1000 * 60)

// eslint-disable-next-line max-lines-per-function
describe('evm', () => {
    // to pass create order, it should specify supported networks
    const srcChainId = 1
    const dstChainId = 137

    let evmSrc: Chain
    let evmDst: Chain

    let evmSrcUser: Wallet
    let evmDstUser: Wallet
    let evmSrcResolver: Wallet
    let evmDstResolver: Wallet

    let srcFactory: EscrowFactory
    let dstFactory: EscrowFactory
    let evmSrcResolverContract: Wallet
    let evmDstResolverContract: Wallet

    let srcTimestamp: bigint

    beforeAll(async () => {
        ;[evmSrc, evmDst] = await Promise.all([
            initChain(srcChainId, evmOwnerPk, evmResolverPk),
            initChain(srcChainId, evmOwnerPk, evmResolverPk)
        ])

        evmSrcUser = new Wallet(evmUserPk, evmSrc.provider)
        evmDstUser = new Wallet(evmUserPk, evmDst.provider)
        evmSrcResolver = new Wallet(evmResolverPk, evmSrc.provider)
        evmDstResolver = new Wallet(evmResolverPk, evmDst.provider)

        srcFactory = new EscrowFactory(evmSrc.provider, evmSrc.escrowFactory)
        dstFactory = new EscrowFactory(evmDst.provider, evmDst.escrowFactory)

        await evmSrcUser.deposit(evmSrc.weth, parseUnits('0.001', 18))
        await evmSrcUser.unlimitedApprove(evmSrc.weth, evmSrc.lop)

        evmSrcResolverContract = await Wallet.fromAddress(evmSrc.resolver, evmSrc.provider)
        evmDstResolverContract = await Wallet.fromAddress(evmDst.resolver, evmDst.provider)

        await evmDstResolver.send({to: evmDstResolverContract, value: parseUnits('0.01', 18)})
        await evmDstResolverContract.deposit(evmDst.weth, parseUnits('0.001', 18))
        await evmDstResolverContract.unlimitedApprove(evmDst.weth, evmDst.escrowFactory)

        srcTimestamp = BigInt((await evmSrc.provider.getBlock('latest'))!.timestamp)
    })

    afterAll(async () => {
        evmSrc.provider.destroy()
        evmDst.provider.destroy()
        await Promise.all([evmSrc.node?.stop(), evmDst.node?.stop()])
    })

    // eslint-disable-next-line max-lines-per-function
    describe('evm -> evm', () => {
        it('should work', async () => {
            const initialBalances = await getBalances([
                {token: evmSrc.weth, user: evmSrcUser, resolver: evmSrcResolverContract},
                {token: evmDst.weth, user: evmDstUser, resolver: evmDstResolverContract}
            ])
            // // User creates order
            const secret = uint8ArrayToHex(randomBytes(32)) // note: use crypto secure random number in real world

            const order = Sdk.CrossChainOrder.new(
                new Address(evmSrc.escrowFactory),
                {
                    salt: Sdk.randBigInt(1000n),
                    maker: new Address(await evmSrcUser.getAddress()),
                    makingAmount: 10000n,
                    takingAmount: 9999n,
                    makerAsset: new Address(evmSrc.weth),
                    takerAsset: new Address(evmDst.weth)
                },
                {
                    hashLock: Sdk.HashLock.forSingleFill(secret),
                    timeLocks: Sdk.TimeLocks.new({
                        srcWithdrawal: 10n, // 10sec finality lock for test
                        srcPublicWithdrawal: 120n, // 2m for private withdrawal
                        srcCancellation: 121n, // 1sec public withdrawal
                        srcPublicCancellation: 122n, // 1sec private cancellation
                        dstWithdrawal: 10n, // 10sec finality lock for test
                        dstPublicWithdrawal: 100n, // 100sec private withdrawal
                        dstCancellation: 101n // 1sec public withdrawal
                    }),
                    srcChainId,
                    dstChainId,
                    srcSafetyDeposit: 1n,
                    dstSafetyDeposit: 1n
                },
                {
                    auction: new Sdk.AuctionDetails({
                        initialRateBump: 0,
                        points: [],
                        duration: 120n,
                        startTime: srcTimestamp
                    }),
                    whitelist: [
                        {
                            address: new Address(evmSrc.resolver),
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
            order.inner.inner.takerAsset = new Address(evmSrc.trueERC20)

            const signature = await evmSrcUser.signOrder(srcChainId, order, evmSrc.lop)
            const orderHash = getOrderHashWithPatch(srcChainId, order, {
                ...patchedDomain,
                verifyingContract: evmSrc.lop
            })

            // // Resolver fills order
            const resolverContract = new Resolver(evmSrc.resolver, evmDst.resolver)
            console.log(`[${srcChainId}]`, `Filling order ${orderHash}`)
            const fillAmount = order.makingAmount

            const {txHash: orderFillHash, blockNumber: srcDeployBlockNumber} = await evmSrcResolver.send(
                resolverContract.deploySrc(
                    srcChainId,
                    evmSrc.lop,
                    order,
                    signature,
                    Sdk.TakerTraits.default()
                        .setExtension(order.extension)
                        .setAmountMode(Sdk.AmountMode.maker)
                        .setAmountThreshold(order.takingAmount),
                    fillAmount
                )
            )
            console.log(`[${srcChainId}]`, `Order ${orderHash} filled for ${fillAmount} in tx ${orderFillHash}`)
            const srcEscrowEvent = await srcFactory.getSrcDeployEvent(srcDeployBlockNumber)
            const dstImmutables = srcEscrowEvent[0]
                .withComplement(srcEscrowEvent[1])
                .withTaker(new Address(resolverContract.dstAddress))

            const {txHash: dstDepositHash, blockTimestamp: dstDeployedAt} = await evmDstResolver.send(
                resolverContract.deployDst(dstImmutables)
            )

            console.log(`[${dstChainId}]`, `Created dst deposit for order ${orderHash} in tx ${dstDepositHash}`)
            const ESCROW_SRC_IMPLEMENTATION = await srcFactory.getSourceImpl()
            const ESCROW_DST_IMPLEMENTATION = await dstFactory.getDestinationImpl()
            const srcEscrowAddress = new Sdk.EscrowFactory(new Address(evmSrc.escrowFactory)).getSrcEscrowAddress(
                srcEscrowEvent[0],
                ESCROW_SRC_IMPLEMENTATION
            )
            const dstEscrowAddress = new Sdk.EscrowFactory(new Address(evmSrc.escrowFactory)).getDstEscrowAddress(
                srcEscrowEvent[0],
                srcEscrowEvent[1],
                dstDeployedAt,
                new Address(resolverContract.dstAddress),
                ESCROW_DST_IMPLEMENTATION
            )
            await increaseTime([evmSrc, evmDst], 11)

            // User shares key after validation of dst escrow deployment
            console.log(`[${dstChainId}]`, `Withdrawing funds for user from ${dstEscrowAddress}`)
            await evmDstResolver.send(
                resolverContract.withdraw(
                    'dst',
                    dstEscrowAddress,
                    secret,
                    dstImmutables.withDeployedAt(dstDeployedAt).build()
                )
            )
            console.log(`[${srcChainId}]`, `Withdrawing funds for resolver from ${srcEscrowAddress}`)
            const {txHash: resolverWithdrawHash} = await evmSrcResolver.send(
                resolverContract.withdraw('src', srcEscrowAddress, secret, srcEscrowEvent[0].build())
            )
            console.log(
                `[${srcChainId}]`,
                `Withdrew funds for resolver from ${srcEscrowAddress} to ${evmSrc.resolver} in tx ${resolverWithdrawHash}`
            )
            const resultBalances = await getBalances([
                {token: evmSrc.weth, user: evmSrcUser, resolver: evmSrcResolverContract},
                {token: evmDst.weth, user: evmDstUser, resolver: evmDstResolverContract}
            ])
            // user transferred funds to resolver on source chain
            expect(initialBalances[0].user - resultBalances[0].user).toBe(order.makingAmount)
            expect(resultBalances[0].resolver - initialBalances[0].resolver).toBe(order.makingAmount)

            // resolver transferred funds to user on destination chain
            expect(resultBalances[1].user - initialBalances[1].user).toBe(order.takingAmount)
            expect(initialBalances[1].resolver - resultBalances[1].resolver).toBe(order.takingAmount)
        })
    })
})
