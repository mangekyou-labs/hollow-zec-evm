import Sdk from './cross-chain-sdk-shims'
import {ethers} from 'ethers'

export const patchedDomain = {
    name: '1inch Limit Order Protocol',
    version: '4',
    verifyingContract: ''
}

export const getOrderHashWithPatch = (
    chainId: number,
    //@ts-ignore
    order: Sdk.CrossChainOrder,
    patcheDomain: {name: string; version: string; verifyingContract: string}
) => {
    const typedData = order.getTypedData(chainId)
    typedData.domain = {
        ...typedData.domain,
        ...patcheDomain
    }
    return ethers.TypedDataEncoder.hash(typedData.domain, {Order: typedData.types.Order}, order.build())
}
