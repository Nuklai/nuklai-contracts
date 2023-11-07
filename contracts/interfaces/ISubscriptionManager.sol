// SPDX-License-Identifier: MIT
pragma solidity =0.8.18;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IDatasetLinkInitializable} from "./IDatasetLinkInitializable.sol";

/**
 * @title Interface of SubscriptionManager contract
 * @notice Defines functions available for Dataset Owner, Subscription Owners, and users
 * @dev Extends IDatasetLinkInitializable and IERC721
 */
interface ISubscriptionManager is IDatasetLinkInitializable, IERC721 {
  /**
   * @notice Verifies if a given subscription is paid for a specified consumer
   * @param dataset ID of the Dataset to access (ID of the target Dataset NFT token)
   * @param consumer Address of consumer, signing the data request
   * @return bool True if subscription is paid for `consumer`, false if it is not
   */
  function isSubscriptionPaidFor(uint256 dataset, address consumer) external view returns (bool);

  /**
   * @notice Returns a fee for a Dataset subscription with a given duration (in days) and number of consumers
   * @param dataset ID of the Dataset to access (ID of the target Dataset NFT token)
   * @param duration The duration of the subscription in days
   * @param consumers Count of consumers who have access to the data using this subscription (including owner)
   * @return token Token used as payment for the subscription, or address(0) for native currency
   * @return amount The fee amount to pay
   */
  function subscriptionFee(
    uint256 dataset,
    uint256 duration,
    uint256 consumers
  ) external view returns (address token, uint256 amount);

  /**
   * @notice Sets the daily subscription fee for a single consumer
   * @param token, The address of the ERC20 token used for subscription payments, or address(0) for native currency
   * @param fee The fee to set
   */
  function setFee(address token, uint256 fee) external;

  /**
   * @notice Returns a fee for adding new consumers to a specific subscription
   * @param subscription ID of subscription (ID of the minted ERC721 token that represents the subscription)
   * @param extraConsumers Count of new consumers to add
   * @return amount The fee amount
   */
  function extraConsumerFee(uint256 subscription, uint256 extraConsumers) external view returns (uint256 amount);

  /**
   * @notice Subscribes to a Dataset and makes payment
   *
   * @dev Requirements:
   *
   *  - `duration` must be greater than 0 and less than or equal to 365
   *  - `consumers` must be greater than 0
   *
   * Emits a {SubscriptionPaid} and a {Transfer} event.
   *
   * @param dataset ID of the Dataset (ID of the target Dataset NFT token)
   * @param duration Duration of the subscription in days
   * @param consumers Count of consumers who have access to the data with this subscription
   * @param maxFee Max amount sender id willing to pay for subscription. Using this prevents race condition with changing the fee while subcsribe tx is in the mempool
   * @return sid ID of subscription (ID of the minted ERC721 token that represents the subscription)
   */
  function subscribe(
    uint256 dataset,
    uint256 duration,
    uint256 consumers,
    uint256 maxFee
  ) external payable returns (uint256 sid);

  /**
   * @notice Subscribes to a Dataset, makes payment and adds consumers' addresses
   *
   * @dev Requirements:
   *
   *  - `duration` must be greater than 0 and less than or equal to 365
   *  - `consumers` length must be greater than 0
   *
   * Emits a {SubscriptionPaid}, a {Transfer}, and {ConsumerAdded} event(s).
   *
   * @param dataset ID of the Dataset (ID of the target Dataset NFT token)
   * @param duration Duration of subscription in days (maximum 365 days)
   * @param consumers Array of consumers who have access to the data with this subscription
   * @param maxFee Max amount sender id willing to pay for subscription. Using this prevents race condition with changing the fee while subcsribe tx is in the mempool
   * @return sid ID of subscription (ID of the minted ERC721 token that represents the subscription)
   */
  function subscribeAndAddConsumers(
    uint256 dataset,
    uint256 duration,
    address[] calldata consumers,
    uint256 maxFee
  ) external payable returns (uint256 sid);

  /**
   * @notice Extends a specific subscription with additional duration (in days) and/or consumers
   * @dev Subscriptions can only be extended duration-wise if remaining duration <= 30 days
   *
   * To extend a subscription only consumer-wise:
   *
   *  - `extraDuration` should be 0
   *  - `extraConsumers` should be greater than 0
   *
   * To extend a subscription only duration-wise:
   *
   *  - `extraDuration` should be greater than 0 and less than or equal to 365
   *  - `extraConsumers` should be 0
   *
   * To extend a subscription both duration-wise and consumer-wise:
   *
   *  -`extraDuration` should be greater than 0 and less than or equal to 365
   *  -`extraConsumers` should be greater than 0
   *
   * Emits a {SubscriptionPaid} event.
   *
   * @param subscription ID of subscription (ID of the minted ERC721 token that represents the subscription)
   * @param extraDuration Days to extend the subscription by
   * @param extraConsumers Number of consumers to add
   * @param maxExtraFee Max amount sender id willing to pay for extending subscription. Using this prevents race condition with changing the fee while subcsribe tx is in the mempool
   */
  function extendSubscription(
    uint256 subscription,
    uint256 extraDuration,
    uint256 extraConsumers,
    uint256 maxExtraFee
  ) external payable;

  /**
   * @notice Adds the given addresses as consumers of an already existing specified subscription
   * @dev Emits {ConsumerAdded} event(s)
   * @param subscription ID of subscription (ID of the NFT token that represents the subscription)
   * @param consumers Array of consumers to have access to the data with the specifed subscription
   */
  function addConsumers(uint256 subscription, address[] calldata consumers) external;

  /**
   * @notice Removes the specified consumers from the set of consumers of the given subscription
   * @dev No refund is paid, but count of consumers is retained.
   * Emits {ConsumerRemoved} event(s).
   * @param subscription ID of subscription (ID of the NFT token that represents the subscription)
   * @param consumers Array with the addresses of the consumers to remove
   */
  function removeConsumers(uint256 subscription, address[] calldata consumers) external;

  /**
   * @notice Replaces a set of old consumers with a same-size set of new consumers for the given subscription
   * @dev Reverts with `CONSUMER_NOT_FOUND` custom error if `oldConsumers` contains address(es) not present in the subscription's
   * current set of consumers.
   * Emits {ConsumerAdded} and {ConsumerRemoved} event(s).
   * @param subscription ID of subscription (ID of the NFT token that represents the subscription)
   * @param oldConsumers Array containing the addresses of consumers to remove
   * @param newConsumers Array containing the addresses of consumers to add
   */
  function replaceConsumers(
    uint256 subscription,
    address[] calldata oldConsumers,
    address[] calldata newConsumers
  ) external;
}
