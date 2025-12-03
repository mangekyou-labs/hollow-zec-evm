// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "cross-chain-swap/mocks/ERC20True.sol";

contract TestERC20True is ERC20True {
    constructor() ERC20True() {}
}
