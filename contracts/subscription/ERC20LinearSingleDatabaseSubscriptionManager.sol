// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./GenericSingleDatasetSubscriptionManager.sol";


contract ERC20LinearSingleDatabaseSubscriptionManager is Initializable, Ownable, GenericSingleDatasetSubscriptionManager {
    using SafeERC20 for IERC20;
 
    IERC20 public token;
    uint256 public feePerConsumerPerSecond;

    constructor() {
        _disableInitializers();
    }


    function initialize(IDatasetNFT dataset_, uint256 datasetId_, address owner) external initializer() {
        __GenericSubscriptionManager_init_unchained(dataset, datasetId_);
        _transferOwnership(owner);
    }

    function setFee(IERC20 token_, uint256 feePerConsumerPerSecond_) external onlyOwner {
        token = token_;
        feePerConsumerPerSecond = feePerConsumerPerSecond_;
    }

    /**
     * @notice Calculates subscription fee
     * @param duration of subscription
     * @param consumers for the subscription (including owner)
     */
    function calculateFee(uint256 duration, uint256 consumers) internal view returns(uint256) {
        return feePerConsumerPerSecond * duration * consumers;
    }

    /**
     * @notice Should charge the subscriber or revert
     * @param subscriber Who to charge
     * @param amount Amount to charge
     */
    function charge(address subscriber, uint256 amount) internal {
        token.safeTransferFrom(subscriber, owner(), amount);
    }

}