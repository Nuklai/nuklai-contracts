// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "./GenericSingleDatasetSubscriptionManager.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";


contract ERC20SingleDatabaseSubscriptionManager is Initializable, Ownable, GenericSingleDatasetSubscriptionManager {
 
    constructor() {
        _disableInitializers();
    }


    function initialize(IDatasetNFT dataset_, uint256 datasetId_, address owner) external initializer() {
        __GenericSubscriptionManager_init_unchained(datset, datasetId_);
        _transferOwnership(owner);
    }

    /**
     * @notice Calculates subscription fee
     * @param duration of subscription
     * @param consumers for the subscription (including owner)
     */
    function calculateFee(uint256 duration, uint256 consumers) internal view returns(uint256) {
        return 0;
    }

    /**
     * @notice Should charge the subscriber or revert
     * @param subscriber Who to charge
     * @param amount Amount to charge
     */
    function charge(address subscriber, uint256 amount) internal {

    }

}