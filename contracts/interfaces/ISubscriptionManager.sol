// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "./IDatasetLinkInitializable.sol";

interface ISubscriptionManager is IERC721, IDatasetLinkInitializable {
    /**
     * @notice Verivies if subscription is paid for a consumer
     * @param dataset Id of the dataset to access
     * @param consumer Address of consumer, signing the data request
     */
    function isSubscriptionPaidFor(uint256 dataset, address consumer) external view returns(bool);

    /**
     * @notice Returns a fee for a dataset subscription
     * @param duration of the subscription
     * @param consumers count of consumers who have access to a data using this subscription
     * @return token Token used to pay subscription or address(0) if native coin
     * @return amount Amount to pay
     */
    function subscriptionFee(uint256 dataset, uint256 duration, uint256 consumers) external view returns(address token, uint256 amount);

    /**
     * @notice Returns a fee to add new consumers to the subscription
     * @param subscription Id of subscriptions
     * @param extraConsumers Count of new consumers
     */
    function extraConsumerFee(uint256 subscription, uint256 extraConsumers) external view returns(uint256 amount);

    /**
     * @notice Subscribe for a dataset and make payment
     * @param dataset Id of the dataset
     * @param start Subscription start timestamp
     * @param duration Duration of subscription
     * @param consumers Liast of consumers who have access to the data with this subscription
     * @return id of subscription
     */
    function subscribe(uint256 dataset, uint256 start, uint256 duration, uint256 consumers) external payable returns(uint256 id);

    /**
     * @notice Extend subscription with additional time or consumers
     * @param subscription Id of subscription
     * @param extraDuration Time to add
     * @param extraConsumers Consumer count to add
     */
    function extendSubscription(uint256 subscription, uint256 extraDuration, uint256 extraConsumers) external payable;

    /**
     * @notice Add consumer addresses to subscription
     * @param subscription Id of subscription
     * @param consumers List of consumers to add
     */
    function addConsumers(uint256 subscription, address[] calldata consumers) external;
    /**
     * @dev No refund is paid, but count of consumers is not decreased
     * @param subscription Id of subscription
     * @param consumers List of consumers to remove
     */
    function removeConsumers(uint256 subscription, address[] calldata consumers) external;
    function replaceConsumers(uint256 subscription, address[] calldata oldConsumers, address[] calldata newConsumers) external;

}