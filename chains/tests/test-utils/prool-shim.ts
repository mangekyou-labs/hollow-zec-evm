import {spawn, ChildProcessWithoutNullStreams} from 'child_process'

export type CreateServerReturnType = {
    start: () => Promise<void>
    stop: () => Promise<void>
    address: () => {address: string; port: number}
}

type CreateServerOptions = {
    instance: {chainId: number}
    limit?: number
}

export function createServer(_options: CreateServerOptions): CreateServerReturnType {
    let processRef: ChildProcessWithoutNullStreams | null = null
    const port = 8545

    return {
        async start(): Promise<void> {
            if (processRef) {
                return
            }

            processRef = spawn('anvil', ['--port', String(port), '--chain-id', String(_options.instance.chainId)], {
                stdio: 'ignore'
            })

            await new Promise((resolve) => setTimeout(resolve, 2000))
        },
        async stop(): Promise<void> {
            if (!processRef) {
                return
            }

            processRef.kill('SIGINT')
            processRef = null
        },
        address(): {address: string; port: number} {
            return {address: '127.0.0.1', port}
        }
    }
}

export function anvil(options: {chainId: number}): {chainId: number} {
    return {chainId: options.chainId}
}


