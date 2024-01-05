// SPDX-License-Identifier: MIT
pragma solidity =0.8.18;

import {IERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/interfaces/IERC165Upgradeable.sol";
import {ERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {
  ERC721EnumerableUpgradeable
} from "@openzeppelin/contracts-upgradeable/token/ERC721/extensions/ERC721EnumerableUpgradeable.sol";
import {ContextUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {ISubscriptionManager} from "../interfaces/ISubscriptionManager.sol";
import {IDatasetNFT} from "../interfaces/IDatasetNFT.sol";
import {
  ERC2771ContextExternalForwarderSourceUpgradeable
} from "../utils/ERC2771ContextExternalForwarderSourceUpgradeable.sol";

/**
 * @title GenericSingleDatasetSubscriptionManager contract
 * @author Nuklai
 * @notice Abstract contract serving as the foundation for managing single Dataset subscriptions and related operations.
 * Derived contracts mint ERC721 tokens that represent subscriptions to the managed Dataset, thus, subscriptions
 * have unique IDs which are the respective minted ERC721 tokens' IDs.
 */
abstract contract GenericSingleDatasetSubscriptionManager is
  Initializable,
  ERC165Upgradeable,
  ERC721EnumerableUpgradeable,
  ERC2771ContextExternalForwarderSourceUpgradeable,
  ISubscriptionManager
{
  using EnumerableSet for EnumerableSet.AddressSet;
  using EnumerableSet for EnumerableSet.UintSet;

  event SubscriptionPaid(uint256 indexed id, uint256 validSince, uint256 validTill, uint256 paidConsumers);
  event ConsumerAdded(uint256 indexed id, address indexed consumer);
  event ConsumerRemoved(uint256 indexed id, address indexed consumer);

  error UNSUPPORTED_DATASET(uint256 id);
  error CONSUMER_NOT_FOUND(uint256 subscription, address consumer);
  error CONSUMER_ALREADY_SUBSCRIBED(address account);
  error CONSUMER_ZERO();
  error MAX_CONSUMERS_ADDITION_REACHED(uint256 total, uint256 current);
  error NOT_SUBSCRIPTION_OWNER(address account);
  error NOT_DATASET_OWNER(address account);
  error SUBSCRIPTION_DURATION_INVALID(uint256 minimum, uint256 maximum, uint256 current);
  error SUBSCRIPTION_ENDED(uint256 validTill, uint256 currentTimestamp);
  error SUBSCRIPTION_REMAINING_DURATION(uint256 maximum, uint256 current);
  error ARRAY_LENGTH_MISMATCH();
  error NOTHING_TO_PAY();
  error SUBSCRIPTION_FEE_EXCEEDS_LIMIT();

  struct SubscriptionDetails {
    uint256 validSince;
    uint256 validTill;
    uint256 paidConsumers;
    EnumerableSet.AddressSet consumers;
  }

  uint256 public constant MAX_SUBSCRIPTION_DURATION_IN_DAYS = 365;
  uint256 public constant MAX_SUBSCRIPTION_EXTENSION_IN_DAYS = 30;
  IDatasetNFT public dataset;
  uint256 public datasetId;
  uint256 internal _mintCounter;

  mapping(uint256 id => SubscriptionDetails) internal _subscriptions;
  mapping(address consumer => EnumerableSet.UintSet subscriptions) internal _consumerSubscriptions;

  modifier onlySubscriptionOwner(uint256 subscription) {
    address msgSender = _msgSender();
    if (ownerOf(subscription) != msgSender) revert NOT_SUBSCRIPTION_OWNER(msgSender);
    _;
  }

  modifier onlyDatasetOwner() {
    address msgSender = _msgSender();
    if (dataset.ownerOf(datasetId) != msgSender) revert NOT_DATASET_OWNER(msgSender);
    _;
  }

  /**
   * @notice Initialization function
   * @param dataset_ The address of the DatasetNFT contract
   * @param datasetId_ The ID of the Dataset NFT token
   */
  function __GenericSubscriptionManager_init(address dataset_, uint256 datasetId_) internal onlyInitializing {
    __ERC2771ContextExternalForwarderSourceUpgradeable_init_unchained(dataset_);
    __GenericSubscriptionManager_init_unchained(dataset_, datasetId_);
    __ERC721Enumerable_init_unchained();
  }

  /**
   * @notice Initialization function
   * @param dataset_ The address of the DatasetNFT contract
   * @param datasetId_ The ID of the Dataset NFT token
   */
  function __GenericSubscriptionManager_init_unchained(address dataset_, uint256 datasetId_) internal onlyInitializing {
    dataset = IDatasetNFT(dataset_);
    datasetId = datasetId_;
  }

  /**
   * @notice Calculates the subscription fee for a given duration (in days) and number of consumers
   * @param durationInDays The duration of the subscription in days
   * @param consumers Number of consumers for the subscription (including owner)
   * @return address The payment token, or address(0) for native coin
   * @return uint256 The amount to pay
   */
  function _calculateFee(uint256 durationInDays, uint256 consumers) internal view virtual returns (address, uint256);

  /**
   * @notice Should charge the subscriber or revert
   * @dev Should call `IDistributionManager.receivePayment()` to distribute the payment
   * @param subscriber Who to charge
   * @param amount Amount to charge
   */
  function _charge(address subscriber, uint256 amount) internal virtual;

  /**
   * @notice Verifies if a given subscription is paid for a specified consumer
   * @param ds ID of the Dataset to access (ID of the target Dataset NFT token)
   * @param consumer Address of consumer, signing the data request
   * @return bool True if subscription is paid for `consumer`, false if it is not
   */
  function isSubscriptionPaidFor(uint256 ds, address consumer) external view returns (bool) {
    _requireCorrectDataset(ds);
    EnumerableSet.UintSet storage subscrs = _consumerSubscriptions[consumer];
    uint256 totalSubscribers = subscrs.length();
    for (uint256 i; i < totalSubscribers; ) {
      uint256 sid = subscrs.at(i);
      if (_subscriptions[sid].validTill > block.timestamp) return true;
      unchecked {
        i++;
      }
    }
    return false;
  }

  /**
   * @notice Returns a fee for a Dataset subscription with a given duration (in days) and number of consumers
   * @param ds ID of the Dataset to access (ID of the target Dataset NFT token)
   * @param durationInDays The duration of the subscription in days
   * @param consumers Count of consumers who have access to the data using this subscription (including owner)
   * @return token Token used as payment for the subscription, or address(0) for native currency
   * @return amount The fee amount to pay
   */
  function subscriptionFee(
    uint256 ds,
    uint256 durationInDays,
    uint256 consumers
  ) external view returns (address token, uint256 amount) {
    _requireCorrectDataset(ds);
    if (durationInDays == 0 || durationInDays > MAX_SUBSCRIPTION_DURATION_IN_DAYS)
      revert SUBSCRIPTION_DURATION_INVALID(1, MAX_SUBSCRIPTION_DURATION_IN_DAYS, durationInDays);
    if (consumers == 0) revert CONSUMER_ZERO();
    return _calculateFee(durationInDays, consumers);
  }

  /**
   * @notice Returns a fee for adding new consumers to a specific subscription
   * @param subscription ID of subscription (ID of the minted ERC721 token that represents the subscription)
   * @param extraConsumers Count of new consumers to add
   * @return amount The fee amount
   */
  function extraConsumerFee(uint256 subscription, uint256 extraConsumers) external view returns (uint256 amount) {
    if (extraConsumers == 0) revert CONSUMER_ZERO();
    SubscriptionDetails storage sd = _subscriptions[subscription];
    if (sd.validTill <= block.timestamp) revert SUBSCRIPTION_ENDED(sd.validTill, block.timestamp);
    // (sd.validTill - sd.validSince) was enforced during subscription to be integral multiple of a day in seconds
    uint256 durationInDays_ = (sd.validTill - sd.validSince) / 1 days;
    (, uint256 currentFee) = _calculateFee(durationInDays_, sd.paidConsumers);
    (, uint256 newFee) = _calculateFee(durationInDays_, sd.paidConsumers + extraConsumers);
    unchecked {
      return (newFee > currentFee) ? (newFee - currentFee) : 0;
    }
  }

  /**
   * @notice Subscribes to a Dataset and makes payment
   *
   * @dev Requirements:
   *
   *  - `durationInDays` must be greater than 0 and less than or equal to 365
   *  - `consumers` must be greater than 0
   *
   * Emits a {SubscriptionPaid} and a {Transfer} event.
   *
   * @param ds ID of the Dataset (ID of the target Dataset NFT token)
   * @param durationInDays Duration of the subscription in days
   * @param consumers Count of consumers who have access to the data with this subscription
   * @param maxFee Max amount sender id willing to pay for subscription. Using this prevents race condition with changing the fee while subcsribe tx is in the mempool
   * @return sid ID of subscription (ID of the minted ERC721 token that represents the subscription)
   */
  function subscribe(
    uint256 ds,
    uint256 durationInDays,
    uint256 consumers,
    uint256 maxFee
  ) external payable returns (uint256 sid) {
    return _subscribe(ds, durationInDays, consumers, maxFee);
  }

  /**
   * @notice Subscribes to a Dataset, makes payment and adds consumers' addresses
   *
   * @dev Requirements:
   *
   *  - `durationInDays` must be greater than 0 and less than or equal to 365
   *  - `consumers` length must be greater than 0
   *
   * Emits a {SubscriptionPaid}, a {Transfer}, and {ConsumerAdded} event(s).
   *
   * @param ds ID of the Dataset (ID of the target Dataset NFT token)
   * @param durationInDays Duration of subscription in days (maximum 365 days)
   * @param consumers Array of consumers who have access to the data with this subscription
   * @param maxFee Max amount sender id willing to pay for subscription. Using this prevents race condition with changing the fee while subcsribe tx is in the mempool
   * @return sid ID of subscription (ID of the minted ERC721 token that represents the subscription)
   */
  function subscribeAndAddConsumers(
    uint256 ds,
    uint256 durationInDays,
    address[] calldata consumers,
    uint256 maxFee
  ) external payable returns (uint256 sid) {
    sid = _subscribe(ds, durationInDays, consumers.length, maxFee);
    _addConsumers(sid, consumers);
  }

  /**
   * @notice Extends a specific subscription with additional duration (in days) and/or consumers to add later
   * @dev Subscriptions can only be extended duration-wise if remaining duration <= 30 days
   *
   * To extend a subscription only consumer-wise:
   *
   *  - `extraDurationInDays` should be 0
   *  - `extraConsumers` should be greater than 0
   *
   * To extend a subscription only duration-wise:
   *
   *  - `extraDurationInDays` should be greater than 0 and less than or equal to 365
   *  - `extraConsumers` should be 0
   *
   * To extend a subscription both duration-wise and consumer-wise:
   *
   *  -`extraDurationInDays` should be greater than 0 and less than or equal to 365
   *  -`extraConsumers` should be greater than 0
   *
   * Emits a {SubscriptionPaid} event.
   *
   * @param subscription ID of subscription (ID of the minted ERC721 token that represents the subscription)
   * @param extraDurationInDays Days to extend the subscription by
   * @param extraConsumers Number of consumers to add
   * @param maxExtraFee Max amount sender id willing to pay for extending subscription. Using this prevents race condition with changing the fee while subcsribe tx is in the mempool
   */
  function extendSubscription(
    uint256 subscription,
    uint256 extraDurationInDays,
    uint256 extraConsumers,
    uint256 maxExtraFee
  ) external payable {
    _extendSubscription(subscription, extraDurationInDays, extraConsumers, maxExtraFee);
  }

  /**
   * @notice Extends a specific subscription with additional duration (in days) and/or add consumers
   * @dev Subscriptions can only be extended duration-wise if remaining duration <= 30 days
   *
   * To extend a subscription only consumer-wise:
   *
   *  - `extraDurationInDays` should be 0
   *  - `extraConsumers` should have at least one consumer
   *
   * To extend a subscription only duration-wise:
   *
   *  - `extraDurationInDays` should be greater than 0 and less than or equal to 365
   *  - `extraConsumers` should be empty array
   *
   * To extend a subscription both duration-wise and consumer-wise:
   *
   *  -`extraDurationInDays` should be greater than 0 and less than or equal to 365
   *  -`extraConsumers` should have at least one consumer
   *
   * Emits a {SubscriptionPaid} event.
   * Emits a {ConsumerAdded} event.
   *
   * @param subscription ID of subscription (ID of the minted ERC721 token that represents the subscription)
   * @param extraDurationInDays Days to extend the subscription by
   * @param extraConsumers Addresses of extra consumers to add
   * @param maxExtraFee Max amount sender id willing to pay for extending subscription. Using this prevents race condition with changing the fee while subcsribe tx is in the mempool
   */
  function extendSubscriptionAndAddExtraConsumers(
    uint256 subscription,
    uint256 extraDurationInDays,
    address[] calldata extraConsumers,
    uint256 maxExtraFee
  ) external payable {
    _extendSubscription(subscription, extraDurationInDays, extraConsumers.length, maxExtraFee);
    if (extraConsumers.length > 0) {
      _addConsumers(subscription, extraConsumers);
    }
  }

  /**
   * @notice Adds the given addresses as consumers of an already existing specified subscription
   * @dev Only callable by the owner of the respective subscription (owner of the ERC721 token that represents the subscription).
   * Emits {ConsumerAdded} event(s).
   * @param subscription ID of subscription (ID of the NFT token that represents the subscription)
   * @param consumers Array of consumers to have access to the data with the specifed subscription
   */
  function addConsumers(
    uint256 subscription,
    address[] calldata consumers
  ) external onlySubscriptionOwner(subscription) {
    _addConsumers(subscription, consumers);
  }

  /**
   * @notice Removes the specified consumers from the set of consumers of the given subscription
   * @dev No refund is paid, but count of consumers is retained.
   * Only callable by the owner of the respective subscription (owner of the ERC721 token that represents the subscription)
   * Emits {ConsumerRemoved} event(s).
   * @param subscription ID of subscription (ID of the NFT token that represents the subscription)
   * @param consumers Array with the addresses of the consumers to remove
   */
  function removeConsumers(
    uint256 subscription,
    address[] calldata consumers
  ) external onlySubscriptionOwner(subscription) {
    _removeConsumers(subscription, consumers);
  }

  /**
   * @notice Replaces a set of old consumers with a same-size set of new consumers for the given subscription
   * @dev Only callable by the owner of the respective subscription (owner of the ERC721 token that represents the subscription).
   * Reverts with `CONSUMER_NOT_FOUND` custom error if `oldConsumers` contains address(es) not present in the subscription's
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
  ) external onlySubscriptionOwner(subscription) {
    _replaceConsumers(subscription, oldConsumers, newConsumers);
  }

  /**
   * @notice Internal subscribe function
   * @dev Mints an ERC721 token that represents the creation of the subscription.
   * Called by `subscribe()` and `subscribeAndAddConsumers()`.
   * Emits a {SubscriptionPaid} and a {Transfer} event.
   * @param ds ID of the Dataset to subscribe to (ID of the target Dataset NFT token)
   * @param durationInDays Duration of subscription in days (maximum 365 days)
   * @param consumers Count of consumers to have access to the data with this subscription
   * @return sid ID of subscription (ID of the minted ERC721 token that represents the subscription)
   */
  function _subscribe(
    uint256 ds,
    uint256 durationInDays,
    uint256 consumers,
    uint256 maxFee
  ) internal returns (uint256 sid) {
    _requireCorrectDataset(ds);
    if (balanceOf(_msgSender()) != 0) revert CONSUMER_ALREADY_SUBSCRIBED(_msgSender());
    if (durationInDays == 0 || durationInDays > MAX_SUBSCRIPTION_DURATION_IN_DAYS)
      revert SUBSCRIPTION_DURATION_INVALID(1, MAX_SUBSCRIPTION_DURATION_IN_DAYS, durationInDays);

    if (consumers == 0) revert CONSUMER_ZERO();

    (, uint256 fee) = _calculateFee(durationInDays, consumers);
    if (fee > maxFee) revert SUBSCRIPTION_FEE_EXCEEDS_LIMIT();
    _charge(_msgSender(), fee);

    sid = ++_mintCounter;
    SubscriptionDetails storage sd = _subscriptions[sid];
    sd.validSince = block.timestamp;
    sd.validTill = block.timestamp + (durationInDays * 1 days);
    sd.paidConsumers = consumers;
    _safeMint(_msgSender(), sid);
    emit SubscriptionPaid(sid, sd.validSince, sd.validTill, sd.paidConsumers);
  }

  /**
   * @notice Internal extendSubscription function
   * @dev Subscriptions can only be extended if remaining duration <= 30 days.
   * Called by `extendSubscription()`.
   * Emits a {SubscriptionPaid} event.
   * @param subscription ID of subscription (ID of the minted ERC721 token that represents the subscription)
   * @param extraDurationInDays Days to extend the subscription by
   * @param extraConsumers Number of extra consumers to add
   * @param maxExtraFee Max amount sender id willing to pay for extending subscription. Using this prevents race condition with changing the fee while subcsribe tx is in the mempool
   */
  function _extendSubscription(
    uint256 subscription,
    uint256 extraDurationInDays,
    uint256 extraConsumers,
    uint256 maxExtraFee
  ) internal {
    _requireMinted(subscription);

    SubscriptionDetails storage sd = _subscriptions[subscription];
    uint256 newDurationInDays;
    uint256 newValidSince;
    uint256 currentFee;

    if (sd.validTill > block.timestamp) {
      // Subscription is still valid but remaining duration must be <= 30 days to extend it
      if (extraDurationInDays > 0) {
        unchecked {
          uint256 remainingDuration = sd.validTill - block.timestamp;
          if (remainingDuration > MAX_SUBSCRIPTION_EXTENSION_IN_DAYS * 1 days)
            revert SUBSCRIPTION_REMAINING_DURATION(MAX_SUBSCRIPTION_EXTENSION_IN_DAYS * 1 days, remainingDuration);
        }
      }

      // (sd.validTill - sd.validSince) was enforced during subscription to be an integral multiple of a day in seconds
      uint256 currentDurationInDays = (sd.validTill - sd.validSince) / 1 days;
      (, currentFee) = _calculateFee(currentDurationInDays, sd.paidConsumers);
      newValidSince = sd.validSince;
      newDurationInDays = currentDurationInDays + extraDurationInDays;
    } else {
      // Subscription is already invalid
      // currentFee = 0;
      newValidSince = block.timestamp;
      newDurationInDays = extraDurationInDays;
    }

    if (newDurationInDays > MAX_SUBSCRIPTION_DURATION_IN_DAYS)
      revert SUBSCRIPTION_DURATION_INVALID(1, MAX_SUBSCRIPTION_DURATION_IN_DAYS, newDurationInDays);

    uint256 newConsumers = sd.paidConsumers + extraConsumers;
    (, uint256 newFee) = _calculateFee(newDurationInDays, newConsumers);
    if (newFee <= currentFee) revert NOTHING_TO_PAY();

    unchecked {
      uint256 chargeFee = newFee - currentFee;
      if (chargeFee > maxExtraFee) revert SUBSCRIPTION_FEE_EXCEEDS_LIMIT();
      _charge(_msgSender(), chargeFee);
    }

    sd.validSince = newValidSince;
    sd.validTill = newValidSince + (newDurationInDays * 1 days);
    sd.paidConsumers = newConsumers;
    emit SubscriptionPaid(subscription, sd.validSince, sd.validTill, sd.paidConsumers);
  }

  /**
   * @notice Internal addConsumers function
   * @dev Called by `addConsumers()` and `subscribeAndAddConsumers()`.
   * Emits {ConsumerAdded} event(s) on condition.
   * @param subscription ID of subscription (ID of the NFT token that represents the subscription)
   * @param consumers Array of consumers to have access to the data with the specifed subscription
   */
  function _addConsumers(uint256 subscription, address[] calldata consumers) internal {
    _requireMinted(subscription);
    SubscriptionDetails storage sd = _subscriptions[subscription];
    if (sd.consumers.length() + consumers.length > sd.paidConsumers)
      revert MAX_CONSUMERS_ADDITION_REACHED(sd.paidConsumers, sd.consumers.length() + consumers.length);
    for (uint256 i; i < consumers.length; ) {
      address consumer = consumers[i];
      bool added = sd.consumers.add(consumer);
      if (added) {
        _consumerSubscriptions[consumer].add(subscription);
        emit ConsumerAdded(subscription, consumer);
      }
      unchecked {
        i++;
      }
    }
  }

  /**
   * @notice Internal removeConsumers function
   * @dev Called by `removeConsumers()`.
   * Emits {ConsumerRemoved} event(s) on condition.
   * @param subscription ID of subscription (ID of the NFT token that represents the subscription)
   * @param consumers Array with the addresses of the consumers to remove
   */
  function _removeConsumers(uint256 subscription, address[] calldata consumers) internal {
    _requireMinted(subscription);
    SubscriptionDetails storage sd = _subscriptions[subscription];
    for (uint256 i; i < consumers.length; ) {
      address consumer = consumers[i];
      bool removed = sd.consumers.remove(consumer);
      if (removed) {
        _consumerSubscriptions[consumer].remove(subscription);
        emit ConsumerRemoved(subscription, consumer);
      }
      unchecked {
        i++;
      }
    }
  }

  /**
   * @notice Internal replaceConsumers function
   * @dev Called by `replaceConsumers()`.
   * Emits {ConsumerAdded}, {ConsumerRemoved} event(s) on conditions.
   * @param subscription ID of subscription (ID of the NFT token that represents the subscription)
   * @param oldConsumers Array containing the addresses of consumers to remove
   * @param newConsumers Array containing the addresses of consumers to add
   */
  function _replaceConsumers(
    uint256 subscription,
    address[] calldata oldConsumers,
    address[] calldata newConsumers
  ) internal {
    _requireMinted(subscription);
    SubscriptionDetails storage sd = _subscriptions[subscription];
    if (oldConsumers.length != newConsumers.length) revert ARRAY_LENGTH_MISMATCH();
    for (uint256 i; i < oldConsumers.length; ) {
      address consumer = oldConsumers[i];
      bool removed = sd.consumers.remove(consumer);
      if (removed) {
        _consumerSubscriptions[consumer].remove(subscription);
        emit ConsumerRemoved(subscription, consumer);
      } else {
        // Should revert because otherwise we can exeed paidConsumers limit
        revert CONSUMER_NOT_FOUND(subscription, consumer);
      }
      consumer = newConsumers[i];
      bool added = sd.consumers.add(consumer);
      if (added) {
        _consumerSubscriptions[consumer].add(subscription);
        emit ConsumerAdded(subscription, consumer);
      }
      unchecked {
        i++;
      }
    }
  }

  /**
   * @notice Reverts with `UNSUPPORTED_DATASET` custom error if `_datasetId` is not the ID of the managed Dataset
   * @dev The ID of the managed dataset is set at `__GenericSubscriptionManager_init_unchained()`
   * @param _datasetId The ID to check
   */
  function _requireCorrectDataset(uint256 _datasetId) internal view {
    if (datasetId != _datasetId) revert UNSUPPORTED_DATASET(_datasetId);
  }

  /**
   * @notice Checks whether the interface ID provided is supported by this Contract
   * @dev For more information, see `EIP-165`
   * @param interfaceId The interface ID to check
   * @return bool true if it is supported, false if it is not
   */
  function supportsInterface(
    bytes4 interfaceId
  ) public view virtual override(ERC165Upgradeable, ERC721EnumerableUpgradeable, IERC165Upgradeable) returns (bool) {
    return interfaceId == type(ISubscriptionManager).interfaceId || super.supportsInterface(interfaceId);
  }

  function _msgSender()
    internal
    view
    virtual
    override(ContextUpgradeable, ERC2771ContextExternalForwarderSourceUpgradeable)
    returns (address sender)
  {
    return ERC2771ContextExternalForwarderSourceUpgradeable._msgSender();
  }

  function _msgData()
    internal
    view
    virtual
    override(ContextUpgradeable, ERC2771ContextExternalForwarderSourceUpgradeable)
    returns (bytes calldata)
  {
    return ERC2771ContextExternalForwarderSourceUpgradeable._msgData();
  }
}
