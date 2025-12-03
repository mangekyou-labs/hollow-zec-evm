import {AbiCoder, Contract, JsonRpcProvider, Signer, TransactionRequest, Wallet as PKWallet} from 'ethers'
import Sdk from '@1inch/cross-chain-sdk'
import ERC20 from './contracts/IERC20.json'
import WETH from './contracts/IWETH.json'

const coder = AbiCoder.defaultAbiCoder()

export class Wallet {
    public provider: JsonRpcProvider
    public signer: Signer

    constructor(privateKeyOrSigner: string | Signer, provider: JsonRpcProvider) {
        this.provider = provider
        this.signer =
            typeof privateKeyOrSigner === 'string'
                ? new PKWallet(privateKeyOrSigner, this.provider)
                : privateKeyOrSigner
    }

    public static async fromAddress(address: string, provider: JsonRpcProvider): Promise<Wallet> {
        await provider.send('anvil_impersonateAccount', [address.toString()])

        const signer = await provider.getSigner(address.toString())

        return new Wallet(signer, provider)
    }

    async tokenBalance(token: string): Promise<bigint> {
        const tokenContract = new Contract(token.toString(), ERC20.abi, this.provider)

        return tokenContract.balanceOf(await this.getAddress())
    }

    async topUpFromDonor(token: string, donor: string, amount: bigint): Promise<void> {
        const donorWallet = await Wallet.fromAddress(donor, this.provider)
        await donorWallet.transferToken(token, await this.getAddress(), amount)
    }

    public async getAddress(): Promise<string> {
        return this.signer.getAddress()
    }

    public async unlimitedApprove(tokenAddress: string, spender: string): Promise<void> {
        const currentApprove = await this.getAllowance(tokenAddress, spender)

        // for usdt like tokens
        if (currentApprove !== 0n) {
            await this.approveToken(tokenAddress, spender, 0n)
        }

        await this.approveToken(tokenAddress, spender, (1n << 256n) - 1n)
    }

    public async getAllowance(token: string, spender: string): Promise<bigint> {
        const contract = new Contract(token.toString(), ERC20.abi, this.provider)

        return contract.allowance(await this.getAddress(), spender.toString())
    }

    public async transfer(dest: string, amount: bigint): Promise<void> {
        await this.signer.sendTransaction({
            to: dest,
            value: amount
        })
    }

    public async deposit(token: string, amount: bigint): Promise<void> {
        const contract = new Contract(token.toString(), WETH.abi, this.signer)

        return contract.deposit({value: amount})
    }

    public async transferToken(token: string, dest: string, amount: bigint): Promise<void> {
        const tx = await this.signer.sendTransaction({
            to: token.toString(),
            data: '0xa9059cbb' + coder.encode(['address', 'uint256'], [dest.toString(), amount]).slice(2)
        })

        await tx.wait()
    }

    public async approveToken(token: string, spender: string, amount: bigint): Promise<void> {
        const tx = await this.signer.sendTransaction({
            to: token.toString(),
            data: '0x095ea7b3' + coder.encode(['address', 'uint256'], [spender.toString(), amount]).slice(2)
        })

        await tx.wait()
    }

    public async signOrder(srcChainId: number, order: Sdk.CrossChainOrder, verifyingContract: string): Promise<string> {
        const typedData = order.getTypedData(srcChainId)

        typedData.domain.name = '1inch Limit Order Protocol'
        typedData.domain.version = '4'
        typedData.domain.verifyingContract = verifyingContract

        return this.signer.signTypedData(
            typedData.domain,
            {Order: typedData.types[typedData.primaryType]},
            typedData.message
        )
    }

    async send(
        param: TransactionRequest
    ): Promise<{txHash: string; blockNumber: number; blockTimestamp: bigint; blockHash: string}> {
        const res = await this.signer.sendTransaction({
            ...param,
            from: this.getAddress()
        })

        const receipt = await res.wait(1)

        if (receipt && receipt.status) {
            // Retry logic to safely fetch block
            const block = await this.getBlockWithRetry(receipt)
            if (!block) throw new Error('Block not found for transaction receipt.')

            return {
                txHash: receipt.hash,
                blockNumber: block.number,
                blockTimestamp: BigInt(block.timestamp),
                blockHash: receipt.blockHash as string
            }
        }

        throw new Error((await receipt?.getResult()) || 'unknown error')
    }

    private async getBlockWithRetry(receipt: any, retries = 10, delayMs = 5000) {
        for (let i = 0; i < retries; i++) {
            console.log(`Attempt ${i + 1}/${retries}: fetching block for tx ${receipt?.hash || 'unknown'}`)
            try {
                const block = await this.provider.getBlock(receipt.blockNumber)
                if (block) return block
            } catch (err) {
                console.warn(`getBlock attempt ${i + 1} failed:`, err)
            }
            if (i < retries - 1) {
                console.log(`Retrying in ${delayMs}ms...`)
                await new Promise((res) => setTimeout(res, delayMs))
            }
        }
        return null
    }
}
