// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "./IDatasetLinkInitializable.sol";

interface ISubscriptionManager is IDatasetLinkInitializable, IERC721 {
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
     * @notice Sets the daily subscription fee for a single consumer
     * @param token, the ERC20 token used for subscription payments, or zero address for native coin
     * @param fee the fee to set
     */
    function setFee(address token, uint256 fee) external;

    /**
     * @notice Sets the daily subscription fee for a single consumer
     * @dev Signed version of `setFee()`
     * @param token, the ERC20 token used for subscription payments, or zero address for native coin
     * @param fee the fee to set
     */
    function setFee_Signed(address token, uint256 fee, bytes calldata signature) external;

    /**
     * @notice Returns a fee to add new consumers to the subscription
     * @param subscription Id of subscriptions
     * @param extraConsumers Count of new consumers
     */
    function extraConsumerFee(uint256 subscription, uint256 extraConsumers) external view returns(uint256 amount);

    /**
     * @notice Subscribe for a dataset and make payment
     * @param dataset Id of the dataset
     * @param duration Duration of subscription
     * @param consumers Count of consumers subscriber can add
     * @return sid of subscription
     */
    function subscribe(uint256 dataset, uint256 duration, uint256 consumers) external payable returns(uint256 sid);

    /**
     * @notice Subscribe for a dataset, make payment and add consumer addresses
     * @param dataset Id of the dataset
     * @param duration Duration of subscription
     * @param consumers List of consumers who have access to the data with this subscription
     * @return sid of subscription
     */
    function subscribeAndAddConsumers(uint256 dataset, uint256 duration, address[] calldata consumers) external payable returns(uint256 sid);
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