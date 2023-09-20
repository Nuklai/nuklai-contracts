// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./GenericSingleDatasetSubscriptionManager.sol";

contract ERC20LinearSingleDatasetSubscriptionManager is GenericSingleDatasetSubscriptionManager {
    using SafeERC20 for IERC20;

    string internal constant TOKEN_NAME = "DataTunnel Subscription";
    string internal constant TOKEN_SYMBOL = "DTSUB";

    error BAD_SIGNATURE(bytes32 msgHash, address recoveredSigner);

    IERC20 public token;
    uint256 public feePerConsumerPerDay;

    modifier onlyDatasetNFT() {
        require(address(dataset) == _msgSender(), "Only DatasetNFT");
        _;
    }

    constructor() ERC721(TOKEN_NAME, TOKEN_SYMBOL) {
        _disableInitializers();
    }

    function initialize(address dataset_, uint256 datasetId_) external initializer() {
        __GenericSubscriptionManager_init_unchained(dataset_, datasetId_);
    }

    /**
     * @notice Sets the daily subscription fee for a single consumer
     * @dev Only callable by the DatasetNFT 
     * @param token_ the ERC20 token used for subscription payments
     * @param feePerConsumerPerDay_ the fee to set
     */
    function setFee(address token_, uint256 feePerConsumerPerDay_) external onlyDatasetNFT {
        token = IERC20(token_);
        feePerConsumerPerDay = feePerConsumerPerDay_;
    }

    /**
     * @notice Calculates subscription fee for a given duration (in days) and number of consumers
     * @param durationInDays the duration of the subscription in days
     * @param consumers number of consumers for the subscription (including owner)
     * @return address the ERC20 token used as payment, zeroAddress for native coin
     * @return uint256 the calculated fee 
     */
    function calculateFee(uint256 durationInDays, uint256 consumers) internal view override returns(address, uint256) {
        return (address(token), feePerConsumerPerDay * durationInDays * consumers);
    }

    /**
     * @notice Should charge the subscriber or revert
     * @dev Should call IDistributionManager.receivePayment() to distribute the payment
     * @param subscriber Who to charge
     * @param amount Amount to charge
     */
    function charge(address subscriber, uint256 amount) internal override {
        token.safeTransferFrom(subscriber, address(this), amount);
        address distributionManager = dataset.distributionManager(datasetId);
        token.approve(distributionManager, amount);
        IDistributionManager(distributionManager).receivePayment(address(token), amount);
    }
}
