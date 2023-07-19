// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "../interfaces/ISubscriptionManager.sol";
import "../interfaces/IDatasetNFT.sol";

abstract contract GenericSingleDatasetSubscriptionManager is ISubscriptionManager, Initializable, Ownable, ERC721 {
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
    mapping(address consumer => EnumerableSet.UintSet subscriptions) internal consumerSupscribsions;


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
     * @param subscriber Who to charge
     * @param amount Amount to charge
     */
    function charge(address subscriber, uint256 amount) internal virtual;



    function __GenericSubscriptionManager_init_unchained(IDatasetNFT dataset_, uint256 datasetId_) internal onlyInitializing() {
        dataset = dataset_;
        datasetId = datasetId_;
    }

    /**
     * @notice Verivies if subscription is paid for a consumer
     * @param ds Id of the dataset to access
     * @param consumer Address of consumer, signing the data request
     */
    function isSubscriptionPaidFor(uint256 ds, address consumer) external view returns(bool) {
        _requireCorrectDataset(ds);
        EnumerableSet.UintSet storage subscrs = consumerSupscribsions[consumer];
        for(uint256 i; i < subscrs.length; i++){
            uint256 sid = subscrs.at(i);
            if(subscriptions[sid].validTill > block.timestamp) return true;
        }
        return false;
    }

    /**
     * @notice Returns a fee for a dataset subscription
     * @param ds Id of the dataset to access
     * @param duration of the subscription
     * @param consumers count of consumers who have access to a data using this subscription
     * @return token Token used to pay subscription or address(0) if native coin
     * @return amount Amount to pay
     */
    function subscriptionFee(uint256 ds, uint256 duration, uint256 consumers) external view returns(address token, uint256 amount) {
        _requireCorrectDataset(ds);
        require(duration > 0, "Duration is too low");
        require(consumers > 0, "Should be at least 1 consumer");
        return calculateFee(duration, consumers);
    }

    /**
     * @notice Returns a fee to add new consumers to the subscription
     * @param subscription Id of subscriptions
     * @param extraConsumers Count of new consumers
     */
    function extraConsumerFee(uint256 subscription, uint256 extraConsumers) external view returns(uint256 amount){
        require(extraConsumers > 0, "Should add at least 1 consumer");
        SubscriptionDetails storage sd = subscriptions[subscription];
        require(sd.validTill > block.timestamp, "Subcription not valid");
        uint256 duration = sd.validTill - sd.validSince;
        uint256 currentFee = calculateFee(duration, sd.paidConsumers);
        uint256 newFee = calculateFee(duration, sd.paidConsumers+extraConsumers);
        return (newFee > currentFee)?(newFee - currentFee):0;
    }

    /**
     * @notice Subscribe for a dataset and make payment
     * @param ds Id of the dataset
     * @param start Subscription start timestamp
     * @param duration Duration of subscription
     * @param consumers Liast of consumers who have access to the data with this subscription
     * @return id of subscription
     */
    function subscribe(uint256 ds, uint256 start, uint256 duration, uint256 consumers) external payable returns(uint256 id){
        _requireCorrectDataset(ds);
        require(start >= block.timestamp, "Start timestamp already passed");
        require(duration > 0, "Duration is too low");
        require(consumers > 0, "Should be at least 1 consumer");

        uint256 fee = calculateFee(duration, consumers);
        charge(_msgSender(), fee);

        uint256 sid = ++mintCounter;
        SubscriptionDetails storage sd = subscriptions[sid];
        sd.validSince = start;
        sd.validTill = start+duration;
        sd.paidConsumers = consumers;
        _safeMint(sid, _msgSender());
        emit SubscriptionPaid(sid, sd.validSince, sd.validTill, sd.paidConsumers);
    }

    /**
     * @notice Extend subscription with additional time or consumers
     * @param subscription Id of subscription
     * @param extraDuration Time to add
     * @param extraConsumers Consumer count to add
     */
    function extendSubscription(uint256 subscription, uint256 extraDuration, uint256 extraConsumers) external payable {
        _requireMinted(subscription);
        SubscriptionDetails storage sd = subscriptions[subscription];

        uint256 newDuration;
        uint256 newValidSince;
        uint256 currentFee;
        if(sd.validTill > block.timestamp) {
            // Subscription is still valid
            uint256 currentDuration = sd.validTill - sd.validSince;
            currentFee = calculateFee(currentDuration, sd.paidConsumers);
            newValidSince = sd.validSince;
            newDuration = currentDuration+extraDuration;
        }else{
            // Subscription is already invalid
            // currentFee = 0;
            newValidSince = block.timestamp;
            newDuration = extraDuration;
        }
        uint256 newConsumers = sd.paidConsumers+extraConsumers;
        uint256 newFee = calculateFee(newDuration, newConsumers);
        require(newFee > currentFee, "Nothing to pay");

        charge(_msgSender(), newFee - currentFee);

        sd.validSince = newValidSince;
        sd.validTill = newValidSince+newDuration;
        sd.paidConsumers = newConsumers;        
        emit SubscriptionPaid(subscription, sd.validSince, sd.validTill, sd.paidConsumers);
    }


    function addConsumers(uint256 subscription, address[] calldata consumers) external {
        _requireMinted(subscription);
        SubscriptionDetails storage sd = subscriptions[subscription];
        require(sd.consumers.length() + consumers.length <= subscription.paidConsumers, "Too many consumers to add");
        for(uint256 i; i < consumers.length; i++){
            address consumer = consumers[i];
            bool added = sd.consumers.add(consumer);
            if(added) {
                consumerSupscribsions[consumer].add(subscription);
            }
        }
    }

    /**
     * @notice Removes consumers from the list for this subscription
     * @dev No refund is paid, but count of consumers is not decreased
     * @param subscription Id of subscription
     * @param consumers List of consumers to remove
     */
    function removeConsumers(uint256 subscription, address[] calldata consumers) external {
        _requireMinted(subscription);
        SubscriptionDetails storage sd = subscriptions[subscription];
        for(uint256 i; i < consumers.length; i++){
            address consumer = consumers[i];
            bool removed = sd.consumers.remove(consumer);
            if(removed) {
                consumerSupscribsions[consumer].remove(subscription);
            }
        }
    }


    function replaceConsumers(uint256 subscription, address[] calldata oldConsumers, address[] calldata newConsumers) external {
        _requireMinted(subscription);
        SubscriptionDetails storage sd = subscriptions[subscription];
        require(oldConsumers.length == newConsumers.length, "Array length missmatch");
        for(uint256 i; i < oldConsumers.length; i++){
            address consumer = oldConsumers[i];
            bool removed = sd.consumers.remove(consumer);
            if(removed) {
                consumerSupscribsions[consumer].remove(subscription);
            } else {
                // Should revert because otherwise we can exeed paidConsumers limit
                revert CONSUMER_NOT_FOUND(subscription, consumer);
            }
            consumer = newConsumers[i];
            bool added = sd.consumers.add(consumer);
            if(added) {
                consumerSupscribsions[consumer].add(subscription);
            }            
        }
    }



    function _requireCorrectDataset(uint256 _datasetId) internal {
        if(datasetId != _datasetId) revert UNSUPPORTED_DATASET(_datasetId);
    }

}