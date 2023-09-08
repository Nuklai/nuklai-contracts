// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "../interfaces/ISubscriptionManager.sol";
import "../interfaces/IDatasetNFT.sol";

abstract contract GenericSingleDatasetSubscriptionManager is ISubscriptionManager, Initializable, ERC721Enumerable {
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.UintSet;

    event SubscriptionPaid(uint256 id, uint256 validSince, uint256 validTill, uint256 paidConsumers);
    event ConsumerAdded(uint256 id, address consumer);
    event ConsumerRemoved(uint256 id, address consumer);

    error UNSUPPORTED_DATASET(uint256 id);
    error CONSUMER_NOT_FOUND(uint256 subscription, address consumer);

    struct SubscriptionDetails {
        uint256 validSince;
        uint256 validTill;
        uint256 paidConsumers;
        EnumerableSet.AddressSet consumers;
    }

    IDatasetNFT public dataset;
    uint256 public datasetId;
    uint256 internal mintCounter;

    mapping(uint256 id => SubscriptionDetails) internal subscriptions;
    mapping(address consumer => EnumerableSet.UintSet subscriptions) internal consumerSubscriptions;

    modifier onlySubscriptionOwner(uint256 subscription) {
        require(ownerOf(subscription) == _msgSender(), "Not a subscription owner");
        _;
    }

    /**
     * @notice Calculates subscription fee
     * @param duration of subscription
     * @param consumers for the subscription (including owner)
     * @return Payment token, zero address for native coin
     * @return amount to pay
     */
    function calculateFee(uint256 duration, uint256 consumers) internal view virtual returns(address, uint256);

    /**
     * @notice Should charge the subscriber or revert
     * @dev Should call IDistributionManager.receivePayment() to distribute the payment
     * @param subscriber Who to charge
     * @param amount Amount to charge
     */
    function charge(address subscriber, uint256 amount) internal virtual;

    function __GenericSubscriptionManager_init_unchained(address dataset_, uint256 datasetId_) internal onlyInitializing() {
        dataset = IDatasetNFT(dataset_);
        datasetId = datasetId_;
    }

    /**
     * @notice Verivies if subscription is paid for a consumer
     * @param ds Id of the dataset to access
     * @param consumer Address of consumer, signing the data request
     */
    function isSubscriptionPaidFor(uint256 ds, address consumer) external view returns(bool) {
        _requireCorrectDataset(ds);
        EnumerableSet.UintSet storage subscrs = consumerSubscriptions[consumer];
        for(uint256 i; i < subscrs.length(); i++){
            uint256 sid = subscrs.at(i);
            if(subscriptions[sid].validTill > block.timestamp) return true;
        }
        return false;
    }

    /**
     * @notice Returns a fee for a dataset subscription
     * @param ds Id of the dataset to access
     * @param duration of the subscription (must be integral multiple of a day in seconds up to 365 days)
     * @param consumers count of consumers who have access to a data using this subscription
     * @return token Token used to pay subscription or address(0) if native coin
     * @return amount Amount to pay
     */
    function subscriptionFee(uint256 ds, uint256 duration, uint256 consumers) external view returns(address token, uint256 amount) {
        _requireCorrectDataset(ds);
        require(duration > 0, "Duration is too low");
        require(duration % 1 days == 0 && duration <= 365 * 1 days, "Invalid subscription duration");
        require(consumers > 0, "Should be at least 1 consumer");
        return calculateFee(duration, consumers);
    }

    /**
     * @notice Returns a fee to add new consumers to the subscription
     * @param subscription Id of subscriptions
     * @param extraConsumers Count of new consumers
     */
    function extraConsumerFee(uint256 subscription, uint256 extraConsumers) external view returns(uint256 amount) {
        require(extraConsumers > 0, "Should add at least 1 consumer");
        SubscriptionDetails storage sd = subscriptions[subscription];
        require(sd.validTill > block.timestamp, "Subcription not valid");
        // duration was enforced during subscription to be integral multiple of days
        uint256 duration = sd.validTill - sd.validSince;
        (,uint256 currentFee) = calculateFee(duration, sd.paidConsumers);
        (,uint256 newFee) = calculateFee(duration, sd.paidConsumers + extraConsumers);
        return (newFee > currentFee) ? (newFee - currentFee) : 0;
    }

    /**
     * @notice Subscribe for a dataset and make payment
     * @param ds Id of the dataset
     * @param start Subscription start timestamp
     * @param duration Duration of subscription (must be integral multiple of a day in seconds up to 365 days)
     * @param consumers Count of consumers who have access to the data with this subscription
     * @return sid of subscription
     */
    function subscribe(uint256 ds, uint256 start, uint256 duration, uint256 consumers) external payable returns(uint256 sid) {
        return _subscribe(ds, start, duration, consumers);
    }

    /**
     * @notice Subscribe for a dataset, make payment and add consumer addresses
     * @param ds Id of the dataset
     * @param start Subscription start timestamp
     * @param duration Duration of subscription (must be integral multiple of a day in seconds up to 365 days)
     * @param consumers List of consumers who have access to the data with this subscription
     * @return sid of subscription
     */
    function subscribeAndAddConsumers(uint256 ds, uint256 start, uint256 duration, address[] calldata consumers) external payable returns(uint256 sid) {
        sid = _subscribe(ds, start, duration, consumers.length);
        _addConsumers(sid, consumers);
    }

    /**
     * @notice Extend subscription with additional time or consumers
     * @dev Subscriptions can only be extended if remaining duration <= 30 days
     * @param subscription Id of subscription
     * @param extraDuration Time to add (must be integral multiple of a day in seconds up to 365 days)
     * @param extraConsumers Consumer count to add
     */
    function extendSubscription(uint256 subscription, uint256 extraDuration, uint256 extraConsumers) external payable {
        _extendSubscription(subscription, extraDuration, extraConsumers);
    }

    function addConsumers(uint256 subscription, address[] calldata consumers) external onlySubscriptionOwner(subscription) {
        _addConsumers(subscription, consumers);
    }

    /**
     * @notice Removes consumers from the list for this subscription
     * @dev No refund is paid, but count of consumers is not decreased
     * @param subscription Id of subscription
     * @param consumers List of consumers to remove
     */
    function removeConsumers(uint256 subscription, address[] calldata consumers) external  onlySubscriptionOwner(subscription) {
        _removeConsumers(subscription, consumers);
    }

    /**
     * @notice Replaces a set of old consumers with a same-size set of new consumers
     * @param subscription Id of subscription
     * @param oldConsumers List of consumers to remove
     * @param newConsumers List of consumers to add
     */
    function replaceConsumers(uint256 subscription, address[] calldata oldConsumers, address[] calldata newConsumers) external onlySubscriptionOwner(subscription) {
        _replaceConsumers(subscription, oldConsumers, newConsumers);
    }


    function _subscribe(uint256 ds, uint256 start, uint256 duration, uint256 consumers) internal returns(uint256 sid) {
        _requireCorrectDataset(ds);
        require(balanceOf(_msgSender()) == 0, "User already subscribed");
        require(start >= block.timestamp, "Start timestamp already passed");
        require(duration > 0, "Duration is too low");
        require(duration % 1 days == 0 && duration <= 365 * 1 days, "Invalid subscription duration");
        require(consumers > 0, "Should be at least 1 consumer");

        (,uint256 fee) = calculateFee(duration, consumers);
        charge(_msgSender(), fee);

        sid = ++mintCounter;
        SubscriptionDetails storage sd = subscriptions[sid];
        sd.validSince = start;
        sd.validTill = start + duration;
        sd.paidConsumers = consumers;
        _safeMint(_msgSender(), sid);
        emit SubscriptionPaid(sid, sd.validSince, sd.validTill, sd.paidConsumers);        
    }

    /**
     * @dev Subscription can only be extended if remaining duration <= 30 days
     * @param subscription Id for subscription
     * @param extraDuration duration to extend the subscription by (must be integral multiple of a day in seconds up to 365 days)
     * @param extraConsumers number of extra consumers to add
     */
    function _extendSubscription(uint256 subscription, uint256 extraDuration, uint256 extraConsumers) internal {
        _requireMinted(subscription);

        if (extraDuration > 0) 
            require(extraDuration % 1 days == 0 && extraDuration <= 365 * 1 days, "Invalid extra duration provided");

        SubscriptionDetails storage sd = subscriptions[subscription];
        uint256 newDuration;
        uint256 newValidSince;
        uint256 currentFee;
        
        if (sd.validTill > block.timestamp) {
            // Subscription is still valid but remaining duration must be <= 30 days to extend it
            if (extraDuration > 0)
                require((sd.validTill - block.timestamp) <= 30 * 1 days, "Remaining duration > 30 days");
            uint256 currentDuration = sd.validTill - sd.validSince;
            (,currentFee) = calculateFee(currentDuration, sd.paidConsumers);
            newValidSince = sd.validSince;
            newDuration = currentDuration + extraDuration;
        } else {
            // Subscription is already invalid
            // currentFee = 0;
            newValidSince = block.timestamp;
            newDuration = extraDuration;
        }
        uint256 newConsumers = sd.paidConsumers + extraConsumers;
        (,uint256 newFee) = calculateFee(newDuration, newConsumers);
        require(newFee > currentFee, "Nothing to pay");

        charge(_msgSender(), newFee - currentFee);

        sd.validSince = newValidSince;
        sd.validTill = newValidSince + newDuration;
        sd.paidConsumers = newConsumers;        
        emit SubscriptionPaid(subscription, sd.validSince, sd.validTill, sd.paidConsumers);
    }

    function _addConsumers(uint256 subscription, address[] calldata consumers) internal {
        _requireMinted(subscription);
        SubscriptionDetails storage sd = subscriptions[subscription];
        require(sd.consumers.length() + consumers.length <= sd.paidConsumers, "Too many consumers to add");
        for(uint256 i; i < consumers.length; i++){
            address consumer = consumers[i];
            bool added = sd.consumers.add(consumer);
            if(added) {
                consumerSubscriptions[consumer].add(subscription);
            }
        }
    }

    function _removeConsumers(uint256 subscription, address[] calldata consumers) internal {
        _requireMinted(subscription);
        SubscriptionDetails storage sd = subscriptions[subscription];
        for(uint256 i; i < consumers.length; i++){
            address consumer = consumers[i];
            bool removed = sd.consumers.remove(consumer);
            if(removed) {
                consumerSubscriptions[consumer].remove(subscription);
            }
        }
    }

    function _replaceConsumers(uint256 subscription, address[] calldata oldConsumers, address[] calldata newConsumers) internal {
        _requireMinted(subscription);
        SubscriptionDetails storage sd = subscriptions[subscription];
        require(oldConsumers.length == newConsumers.length, "Array length missmatch");
        for(uint256 i; i < oldConsumers.length; i++){
            address consumer = oldConsumers[i];
            bool removed = sd.consumers.remove(consumer);
            if(removed) {
                consumerSubscriptions[consumer].remove(subscription);
            } else {
                // Should revert because otherwise we can exeed paidConsumers limit
                revert CONSUMER_NOT_FOUND(subscription, consumer);
            }
            consumer = newConsumers[i];
            bool added = sd.consumers.add(consumer);
            if(added) {
                consumerSubscriptions[consumer].add(subscription);
            }            
        }
    }    

    function _requireCorrectDataset(uint256 _datasetId) internal view {
        if(datasetId != _datasetId) revert UNSUPPORTED_DATASET(_datasetId);
    }

}