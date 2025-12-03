import * as sdkNamespace from '@1inch/cross-chain-sdk'

const Sdk = (sdkNamespace as any).default ?? sdkNamespace

export default Sdk
