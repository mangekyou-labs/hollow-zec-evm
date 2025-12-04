import {computeAddress, ContractFactory, JsonRpcProvider} from 'ethers'
import {createServer, CreateServerReturnType} from 'prool'
import {anvil} from 'prool/instances'
import {Wallet as SignerWallet} from 'ethers'
import assert from 'node:assert'
import * as Sdk from '@1inch/cross-chain-sdk'
import trueERC20Contract from '../../dist/contracts/evm/ERC20True.sol/ERC20True.json'
import wethContract from '../../dist/contracts/evm/WETH9.sol/WETH9.json'
import lopContract from '../../dist/contracts/evm/LimitOrderProtocol.sol/LimitOrderProtocol.json'
import factoryContract from '../../dist/contracts/evm/EscrowFactory.sol/EscrowFactory.json'
import resolverContract from '../../dist/contracts/evm/Resolver.sol/Resolver.json'
import {Wallet} from '../../sdk/evm/wallet'

const {Address} = Sdk

export type Chain = {
    node?: any | undefined
    provider: JsonRpcProvider
    trueERC20: string
    weth: string
    lop: string
    escrowFactory: string
    resolver: string
}

// default addresses
export const evmOwnerPk = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
export const evmUserPk = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
export const evmResolverPk = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'

export async function increaseTime(chains: Chain[], t: number): Promise<void> {
    await Promise.all(chains.map((chain) => chain.provider.send('evm_increaseTime', [t])))
}

export async function getProvider(
    chainId: number
): Promise<{node?: CreateServerReturnType; provider: JsonRpcProvider}> {
    const node = createServer({
        instance: anvil({chainId}),
        limit: 1
    })
    await node.start()

    const address = node.address()
    assert(address)

    const provider = new JsonRpcProvider(`http://${address.address}:${address.port}`, chainId, {
        cacheTimeout: -1,
        staticNetwork: true
    })

    return {
        provider,
        node
    }
}

/**
 * Deploy contract and return its address
 */
export async function deploy(
    json: {abi: any; bytecode: any},
    params: unknown[],
    deployer: SignerWallet
): Promise<string> {
    const deployed = await new ContractFactory(json.abi, json.bytecode, deployer).deploy(...params)
    await deployed.waitForDeployment()
    return await deployed.getAddress()
}

export async function initChain(
    chainId: number,
    ownerPk: string,
    resolverPk: string
): Promise<{
    node?: CreateServerReturnType
    provider: JsonRpcProvider
    trueERC20: string
    weth: string
    lop: string
    escrowFactory: string
    resolver: string
}> {
    const {node, provider} = await getProvider(chainId)
    const deployer = new SignerWallet(ownerPk, provider)

    // deploy TrueERC20
    const trueERC20 = await deploy(trueERC20Contract, [], deployer)
    console.log(`[${chainId}]`, `TrueERC20 contract deployed to`, trueERC20)

    // deploy WETH
    const weth = await deploy(wethContract, [], deployer)
    console.log(`[${chainId}]`, `WETH contract deployed to`, weth)

    // deploy LOP
    const lop = await deploy(lopContract, [weth], deployer)
    console.log(`[${chainId}]`, `LOP contract deployed to`, lop)

    // deploy EscrowFactory
    const escrowFactory = await deploy(
        factoryContract,
        [
            lop,
            weth, // feeToken,
            Address.fromBigInt(0n).toString(), // accessToken,
            deployer.address, // owner
            60 * 30, // src rescue delay
            60 * 30 // dst rescue delay
        ],
        deployer
    )
    console.log(`[${chainId}]`, `Escrow factory contract deployed to`, escrowFactory)

    // deploy Resolver contract
    const resolver = await deploy(
        resolverContract,
        [
            escrowFactory,
            lop,
            computeAddress(resolverPk) // resolver as owner of contract
        ],
        deployer
    )
    console.log(`[${chainId}]`, `Resolver contract deployed to`, resolver)

    return {node: node, provider, trueERC20, weth, lop, resolver, escrowFactory}
}

export async function getBalances(
    inputs: {token: string; user: Wallet; resolver: Wallet}[]
): Promise<{user: bigint; resolver: bigint}[]> {
    return Promise.all(
        inputs.map(async ({token, user, resolver}) => ({
            user: await user.tokenBalance(token),
            resolver: await resolver.tokenBalance(token)
        }))
    )
}
