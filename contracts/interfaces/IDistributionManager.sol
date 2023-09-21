// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./IDatasetLinkInitializable.sol";

interface IDistributionManager is IDatasetLinkInitializable {
    /**
     * @notice Called by SubscriptionManager to initiate payment
     * @dev if token is address(0) - native currency, the amount should match the msg.value
     * otherwise DistributionManager should call `transferFrom()` to transfer the amount from sender
     * @param token Payment token ERC20, address(0) means native currency
     * @param amount Payment amount
     */
    function receivePayment(address token, uint256 amount) external payable;

    /**
     * @notice Claim all payouts
     */
    function claimPayouts(uint256 sigValidSince, uint256 sigValidTill, bytes calldata signature) external;

    function getTagWeights(bytes32[] calldata tags) external view returns(uint256[] memory weights);

    function setTagWeights(bytes32[] calldata tags, uint256[] calldata weights) external;

    function setDatasetOwnerPercentage(uint256 percentage) external;
}