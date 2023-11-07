// SPDX-License-Identifier: MIT
pragma solidity =0.8.18;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IDistributionManager} from "../interfaces/IDistributionManager.sol";
import {GenericSingleDatasetSubscriptionManager} from "./GenericSingleDatasetSubscriptionManager.sol";

/**
 * @title ERC20SubscriptionManager contract
 * @author Data Tunnel
 * @notice This implementation contract handles Dataset subscription operations using ERC20 tokens as payments.
 *
 * It calculates subscription fees based on a 3rd degree polynomial formula f(x, y, z) where:
 *
 *  - f(x, y, z) = x * y * z
 *  - x : The fee per consumer per day
 *  - y : The number of days
 *  - z : The number of consumers
 *
 * This is the implementation contract, and each Dataset (represented by a Dataset NFT token) is associated
 * with a specific instance of this implementation.
 */
contract ERC20SubscriptionManager is GenericSingleDatasetSubscriptionManager {
  using SafeERC20 for IERC20;

  string internal constant _NAME = "Data Tunnel Subscription";
  string internal constant _SYMBOL = "DTSUB";

  error NOT_APPROVED_TOKEN(address token);
  error UNSUPPORTED_NATIVE_CURRENCY();
  error UNSUPPORTED_MSG_VALUE();

  IERC20 public token;
  uint256 public feePerConsumerPerDay;

  constructor() ERC721(_NAME, _SYMBOL) {
    _disableInitializers();
  }

  /**
   * @notice Initialization function
   * @dev Initializes the contract by setting the `dataset` and `datasetId` state variables
   * (see `GenericSingleDatasetSubscriptionManager.sol`)
   * @param dataset_ The address of the DatasetNFT contract
   * @param datasetId_ The ID of the Dataset NFT token
   */
  function initialize(address dataset_, uint256 datasetId_) external initializer {
    __GenericSubscriptionManager_init(dataset_, datasetId_);
  }

  /**
   * @notice Sets the daily subscription fee for a single consumer
   * @dev Only callable by the Dataset owner.
   * `token_` must be approved by DatasetNFT ADMIN (see `DatasetNFT.sol`).
   * `address(0)` (indicating natice currency) is not supported by this SubscriptionManager implementation.
   * @param token_ The address of the ERC20 token to be used for subscription payments
   * @param feePerConsumerPerDay_ The fee to set
   */
  function setFee(address token_, uint256 feePerConsumerPerDay_) external onlyDatasetOwner {
    if (token_ == address(0)) revert UNSUPPORTED_NATIVE_CURRENCY();
    if (!dataset.isApprovedToken(token_)) revert NOT_APPROVED_TOKEN(token_);
    token = IERC20(token_);
    feePerConsumerPerDay = feePerConsumerPerDay_;
  }

  /**
   * @notice Calculates subscription fee for a given duration (in days) and number of consumers
   * @param durationInDays The duration of the subscription in days
   * @param consumers Number of consumers for the subscription (including owner)
   * @return address The address of the ERC20 token used as payment
   * @return uint256 The calculated fee
   */
  function _calculateFee(uint256 durationInDays, uint256 consumers) internal view override returns (address, uint256) {
    return (address(token), feePerConsumerPerDay * durationInDays * consumers);
  }

  /**
   * @notice Should charge the subscriber or revert
   * @dev Should call `IDistributionManager.receivePayment()` to distribute the payment
   * @param subscriber Who to charge
   * @param amount Amount to charge
   */
  function _charge(address subscriber, uint256 amount) internal override {
    if (msg.value > 0) revert UNSUPPORTED_MSG_VALUE();
    token.safeTransferFrom(subscriber, address(this), amount);
    address distributionManager = dataset.distributionManager(datasetId);
    token.approve(distributionManager, amount);
    IDistributionManager(distributionManager).receivePayment(address(token), amount);
  }
}
