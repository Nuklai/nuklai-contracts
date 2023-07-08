// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "./IDistributionManager.sol";
import "./ISubscriptionManager.sol";
import "./IVerifierManager.sol";

/**
 * @title Interface of Datset NFT
 * @notice Defines function available for Dataset Admins and FragmentNFT contract
 */
interface IDatasetNFT is IERC721 {
    struct DatasetConfig {
        ISubscriptionManager subscriptionManager;
        IDistributionManager distributionManager;
        IVerifierManager verifierManager;
    }

    function mint(uint256 id, address to, bytes calldata signature) external;
    function setConfig(uint256 id, DatasetConfig calldata config) external;
    function deployFragmentInstance(uint256 id) external returns(address);
    function isSigner(address signer) external view returns(bool);
}