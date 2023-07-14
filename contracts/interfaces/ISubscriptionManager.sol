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
     * @notice Subscribe for a dataset and make payment
     * @param dataset Id of the dataset
     * @param start Subscription start timestamp
     * @param duration Duration of subscription
     * @param consumers Liast of consumers who have access to the data with this subscription
     * @return id of subscription
     */
    function subscribe(uint256 dataset, uint256 start, uint256 duration, address[] calldata consumers) external payable returns(uint256 id);

    function addConsumers(uint256 subscription, address[] calldata consumers) external;
    function removeConsumers(uint256 subscription, address[] calldata consumers) external;
    function replaceConsumers(uint256 subscription, address[] calldata oldConsumers, address[] calldata newConsumers) external;

}