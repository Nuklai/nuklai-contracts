// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import {ERC721} from '@openzeppelin/contracts/token/ERC721/ERC721.sol';
import {IDistributionManager} from '../interfaces/IDistributionManager.sol';
import {GenericSingleDatasetSubscriptionManager} from './GenericSingleDatasetSubscriptionManager.sol';

/**
 * @title ERC20SubscriptionManager contract
 * @author Data Tunnel
 * @notice This implementation contract handles Dataset subscription operations using ERC20 tokens or native currency as payments.
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
 * @dev Extends GenericSingleDatasetSubscriptionManager
 */
contract ERC20SubscriptionManager is GenericSingleDatasetSubscriptionManager {
  using SafeERC20 for IERC20;

  string internal constant _NAME = 'Data Tunnel Subscription';
  string internal constant _SYMBOL = 'DTSUB';

  IERC20 public token;
  uint256 public feePerConsumerPerDay;

  modifier onlyDatasetNFT() {
    require(address(dataset) == _msgSender(), 'Only DatasetNFT');
    _;
  }

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
    __GenericSubscriptionManager_init_unchained(dataset_, datasetId_);
  }

  /**
   * @notice Sets the daily subscription fee for a single consumer
   * @dev Only callable by the DatasetNFT
   * @param token_ The address of the ERC20 token to be used for subscription payments, or address(0) for native currency
   * @param feePerConsumerPerDay_ The fee to set
   */
  function setFee(address token_, uint256 feePerConsumerPerDay_) external onlyDatasetNFT {
    token = IERC20(token_);
    feePerConsumerPerDay = feePerConsumerPerDay_;
  }

  /**
   * @notice Calculates subscription fee for a given duration (in days) and number of consumers
   * @param durationInDays The duration of the subscription in days
   * @param consumers Number of consumers for the subscription (including owner)
   * @return address The address of the ERC20 token used as payment, or address(0) for native currency
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
    token.safeTransferFrom(subscriber, address(this), amount);
    address distributionManager = dataset.distributionManager(datasetId);
    token.approve(distributionManager, amount);
    IDistributionManager(distributionManager).receivePayment(address(token), amount);
  }
}
