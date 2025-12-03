const DEPLOYED_AT_MASK = 0xffffffff00000000000000000000000000000000000000000000000000000000n
const DEPLOYED_AT_OFFSET = 224n

export function setDeployedAt(timelocks: bigint, value: bigint) {
    // Ensure BigInts
    timelocks = BigInt(timelocks)
    value = BigInt(value)

    // Clear the deployedAt bits
    const cleared = timelocks & ~DEPLOYED_AT_MASK

    // Shift the new value into place
    const shiftedValue = value << DEPLOYED_AT_OFFSET

    // OR to set the new value
    return cleared | shiftedValue
}
