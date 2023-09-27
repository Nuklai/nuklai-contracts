// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./IDatasetLinkInitializable.sol";

/**
 * @title DistributionManager Interface
 * @notice Defines functions available for Dataset NFT token owner, users, contributors, DatasetNFT & SubscriptionManager contracts
 * @dev Extends IDatasetLinkInitializable
 */
interface IDistributionManager is IDatasetLinkInitializable {
  /**
   * @notice Receives a subscription payment, sends deployer fee to configured beneficiary, and
   * creates a record of the amounts eligible for claiming by the Dataset owner and contributors respectively.
   * @dev Called by SubscriptionManager when a subscription payment is initiated.
   * If `token` is address(0) (indicating native currency), the `amount` should match the `msg.value`,
   * otherwise DistributionManager should call `transferFrom()` to transfer the amount from sender.
   * Emits {PaymentReceived} and {PayoutSent} events.
   * @param token The address of the ERC20 payment token, or address(0) indicating native currency
   * @param amount The provided payment amount
   */
  function receivePayment(address token, uint256 amount) external payable;

  /**
   * @notice Sends all respective unclaimed contribution-fee payouts to the contributor
   * @dev In the context of this function, the caller is the contributor (FragmentNFT token owner).
   * Emits {PayoutSent} event(s).
   * @param sigValidSince The Unix timestamp after which claiming is enabled
   * @param sigValidTill The Unix timestamp until which claiming is enabled
   * @param signature Signature from a DT service confirming the claiming request
   */
  function claimPayouts(uint256 sigValidSince, uint256 sigValidTill, bytes calldata signature) external;

  /**
   * @notice Retrieves the respective weights of the provided tags
   * @dev The weights define how payments are distributed to the tags (contributions).
   * Tags are encodings used as labels to categorize different types of contributions (see `FragmentNFT.sol`).
   * If a tag present in the `tags` array is not set by the Dataset onwer, its respective weight is 0.
   * @param tags An array with the tags to retrieve their weights
   * @return weights An array with the respective weights
   */
  function getTagWeights(bytes32[] calldata tags) external view returns (uint256[] memory weights);

  /**
   * @notice Sets the weights of the respective provided tags.
   * @dev Weights are encoded such that 100% is represented as 1e18.
   * The weights define how payments are distributed to the tags (contributions).
   * Tags are encodings used as labels to categorize different types of contributions.
   * @param tags The tags participating in the payment distributions
   * @param weights The weights of the respective tags to set
   */
  function setTagWeights(bytes32[] calldata tags, uint256[] calldata weights) external;

  /**
   * @notice Sets the percentage of each subcription payment that should be sent to the Dataset Owner.
   * Percentages are encoded such that 100% is represented as 1e18.
   * @param percentage The percentage to set (must be less than or equal to 50%)
   */
  function setDatasetOwnerPercentage(uint256 percentage) external;
}
