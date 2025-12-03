// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../../lib/others/WETH9.sol";

contract TestWETH9 is WETH9 {
    constructor() WETH9() {}
}
