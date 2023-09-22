// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import '@openzeppelin/contracts/token/ERC721/IERC721.sol';
import './IDistributionManager.sol';
import './ISubscriptionManager.sol';
import './IVerifierManager.sol';

/**
 * @title Interface of Datset NFT
 * @notice Defines function available for Dataset Admins and FragmentNFT contract
 */
interface IDatasetNFT is IERC721 {
  // Defines the model for the deployer (ALlianceblock/Nexera) fee
  enum DeployerFeeModel {
    NO_FEE, // No Fee wii
    DATASET_OWNER_STORAGE, // Using Owner's Storage, 10% fee
    DEPLOYER_STORAGE // Deployer's Storage 35% fee
  }

  struct ManagersConfig {
    address subscriptionManager;
    address distributionManager;
    address verifierManager;
  }

  function mint(address to, bytes calldata signature) external returns (uint256);

  function setUuidForDatasetId(string memory uuid) external returns (uint256);

  function setManagers(uint256 id, ManagersConfig calldata config) external;

  function deployFragmentInstance(uint256 id) external returns (address);

  function setFee(uint256 id, address token, uint256 feePerConsumerPerDay) external;

  function setDatasetOwnerPercentage(uint256 id, uint256 percentage) external;

  function setTagWeights(uint256 id, bytes32[] calldata tags, uint256[] calldata weights) external;

  function setFeeAndTagWeights(
    uint256 id,
    address token,
    uint256 feePerConsumerPerDay,
    bytes32[] calldata tags,
    uint256[] calldata weights
  ) external;

  function proposeFragment(uint256 datasetId, address to, bytes32 tag, bytes calldata signature) external;

  function proposeManyFragments(
    uint256 datasetId,
    address[] memory owners,
    bytes32[] memory tags,
    bytes calldata signature
  ) external;

  function subscriptionManager(uint256 id) external view returns (address);

  function verifierManager(uint256 id) external view returns (address);

  function distributionManager(uint256 id) external view returns (address);

  function fragmentNFT(uint256 id) external view returns (address);

  function deployerFeePercentage(uint256 id) external view returns (uint256);

  function deployerFeeBeneficiary() external view returns (address);

  function isSigner(address account) external view returns (bool);
}
