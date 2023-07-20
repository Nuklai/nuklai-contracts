// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./GenericSingleDatasetSubscriptionManager.sol";


contract ERC20LinearSingleDatabaseSubscriptionManager is Initializable,  GenericSingleDatasetSubscriptionManager {
    using SafeERC20 for IERC20;

    string internal constant TOKEN_NAME = "DataTunel Subscription";
    string internal constant TOKEN_SYMBOL = "DTSUB";

    IERC20 public token;
    uint256 public feePerConsumerPerSecond;
    address beneficiary;

    modifier onlyDatasetOwner() {
        require(dataset.ownerOf(datasetId) == _msgSender(), "Not a Dataset owner");
        _;
    }


    constructor() ERC721(TOKEN_NAME, TOKEN_SYMBOL) {
        _disableInitializers();
    }


    function initialize(address dataset_, uint256 datasetId_) external initializer() {
        __GenericSubscriptionManager_init_unchained(dataset_, datasetId_);
    }

    function setFee(IERC20 token_, uint256 feePerConsumerPerSecond_, address beneficiary_) external onlyDatasetOwner {
        token = token_;
        feePerConsumerPerSecond = feePerConsumerPerSecond_;
        beneficiary = beneficiary_;
    }

    /**
     * @notice Calculates subscription fee
     * @param duration of subscription
     * @param consumers for the subscription (including owner)
     */
    function calculateFee(uint256 duration, uint256 consumers) internal view override returns(address, uint256) {
        return (address(token), feePerConsumerPerSecond * duration * consumers);
    }

    /**
     * @notice Should charge the subscriber or revert
     * @param subscriber Who to charge
     * @param amount Amount to charge
     */
    function charge(address subscriber, uint256 amount) internal override {
        token.safeTransferFrom(subscriber, beneficiary, amount);
    }

}