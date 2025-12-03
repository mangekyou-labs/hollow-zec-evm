// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "forge-std/Script.sol";

// Contract imports
import {LimitOrderProtocol} from "@1inch/limit-order-protocol-contract/contracts/LimitOrderProtocol.sol";
import {EscrowFactory} from "cross-chain-swap/EscrowFactory.sol";
import {ERC20True} from "cross-chain-swap/mocks/ERC20True.sol";
import {IWETH} from "@1inch/solidity-utils/contracts/interfaces/IWETH.sol";
import {IERC20} from "openzeppelin-contracts/contracts/interfaces/IERC20.sol";

import {WETH9} from "../../contracts/evm/lib/others/WETH9.sol";
import {Resolver} from "../../contracts/evm/src/Resolver.sol";


contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("ETH_PRIVATE_KEY");
        address owner = vm.addr(deployerKey);

        uint256 chainId = block.chainid;
        IWETH weth;

        if (chainId == 84532) {
            weth = IWETH(0x1BDD24840e119DC2602dCC587Dd182812427A5Cc);
        } else if (chainId == 421614) {
            weth = IWETH(0x2836ae2eA2c013acD38028fD0C77B92cccFa2EE4);
        } else if (chainId == 10143) {
            weth = IWETH(0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701);
        } else if (chainId == 128123){
            weth = IWETH(0xB1Ea698633d57705e93b0E40c1077d46CD6A51d8);
        } 
        else {
            // Deploy local WETH9 if on unknown chain (e.g., anvil)
            WETH9 weth9 = new WETH9();
            weth = IWETH(address(weth9));
            console.log("Local WETH9 deployed at:", address(weth9));
        }

        vm.startBroadcast(deployerKey);

        // 1. Deploy LimitOrderProtocol
        LimitOrderProtocol lop = new LimitOrderProtocol(weth);
        console.log("LimitOrderProtocol deployed at:", address(lop));

        // 2. Deploy EscrowFactory
        EscrowFactory factory = new EscrowFactory(
            address(lop),
            weth,
            IERC20(address(0)), // zero address
            owner,
            1800,
            1800
        );
        console.log("EscrowFactory deployed at:", address(factory));

        // 3. Deploy Resolver
        Resolver resolver = new Resolver(
            factory,
            lop,
            owner
        );
        console.log("Resolver deployed at:", address(resolver));

        // 4. Deploy ERC20True
        ERC20True token = new ERC20True();
        console.log("ERC20True deployed at:", address(token));

        vm.stopBroadcast();
    }
}
