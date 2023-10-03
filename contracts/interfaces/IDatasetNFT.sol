// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC721Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721Upgradeable.sol";

/**
 * @title Interface of DatasetNFT
 * @notice Defines functions available for DatasetNFT Admin, Dataset Owners and FragmentNFT contract
 * @dev Extends IERC721Upgradeable
 */
interface IDatasetNFT is IERC721Upgradeable {
  ///@dev Defines the model for the deployer (ALlianceblock/Nexera) fee
  enum DeployerFeeModel {
    NO_FEE, // No Fee wii
    DATASET_OWNER_STORAGE, // Using Owner's Storage, 10% fee
    DEPLOYER_STORAGE // Deployer's Storage 35% fee
  }

  ///@dev Managers' implementation contracts addresses
  struct ManagersConfig {
    address subscriptionManager;
    address distributionManager;
    address verifierManager;
  }

  /**
   * @notice Mints a Dataset NFT token to `to`
   * @param uuidHash The hash of the off-chain generated UUID for the Dataset
   * @param to Dataset owner
   * @param signature Signature from a DT service confirming creation of Dataset
   * @return uint256 ID of the minted token
   */
  function mint(bytes32 uuidHash, address to, bytes calldata signature) external returns (uint256);

  /**
   * @notice Sets and configures the Manager contracts for a specific Dataset NFT
   * @dev Each Dataset NFT token is linked to a unique set of Manager contracts (Distribution, Subscription, Verifier).
   * Emits a {ManagersConfigChange} event on condition.
   * @param id The ID of the target DatasetNFT token
   * @param config A struct containing the addresses of the Managers' implementation contracts
   */
  function setManagers(uint256 id, ManagersConfig calldata config) external;

  /**
   * @notice Deploys a clone of the FragmentNFT implementation contract for a specific Dataset
   * @dev Emits a {FragmentInstanceDeployment} event
   * @param id The ID of the target Dataset NFT token
   * @return address The address of the deployed FragmentNFT instance
   */
  function deployFragmentInstance(uint256 id) external returns (address);

  /**
   * @notice Proposes a specific type of contribution for a particular Dataset
   * @param datasetId The ID of the target Dataset NFT token
   * @param to The address of the contributor
   * @param tag The encoded label indicating the type of contribution
   * @param signature Signature from a DT service confirming the proposal request
   */
  function proposeFragment(uint256 datasetId, address to, bytes32 tag, bytes calldata signature) external;

  /**
   * @notice Proposes multiple contributions for a specific Dataset
   * @param datasetId The ID of the target Dataset NFT token
   * @param owners An array with the respective contributors' addresses
   * @param tags An array with the respective encoded labels indicating the type of the contributions
   * @param signature Signature from a DT service confirming the proposal request
   */
  function proposeManyFragments(
    uint256 datasetId,
    address[] memory owners,
    bytes32[] memory tags,
    bytes calldata signature
  ) external;

  /**
   * @notice Retrieves the address of the SubscriptionManager instance that is deployed for a specific Dataset
   * @param id The ID of the target Dataset NFT token
   * @return address The address of the respective SubscriptionManager instance
   */
  function subscriptionManager(uint256 id) external view returns (address);

  /**
   * @notice Retrieves the address of the VerifierManager instance that is deployed for a specific Dataset
   * @param id The ID of the target Dataset NFT token
   * @return address The address of the respective VerifierManager instance
   */
  function verifierManager(uint256 id) external view returns (address);

  /**
   * @notice Retrieves the address of the DistributionManager instance that is deployed for a specific Dataset
   * @param id The ID of the target Dataset NFT token
   * @return address The address of the respective DistributionManager instance
   */
  function distributionManager(uint256 id) external view returns (address);

  /**
   * @notice Retrieves the address of the FragmentNFT instance that is deployed for a specific Dataset
   * @param id The ID of the target Dataset NFT token
   * @return address The address of the respective FragmentNFT instance
   */
  function fragmentNFT(uint256 id) external view returns (address);

  /**
   * @notice Retrieves the deployer fee percentage set for a specific Dataset
   * @dev Percentages are encoded such that 100% is represented as 1e18
   * @param id The ID of the target Dataset NFT token
   * @return uint256 The inquired percentage
   */
  function deployerFeePercentage(uint256 id) external view returns (uint256);

  /**
   * @notice Retrieves the deployer fee beneficiary address
   * @return address The address set as the beneficiary of the deployer fee
   */
  function deployerFeeBeneficiary() external view returns (address);

  /**
   * @notice Checks whether the given account has the `SIGNER_ROLE`
   * @param account The address of the account to check
   * @return bool True if `account` has the role, false if not
   */
  function isSigner(address account) external view returns (bool);

  /**
   * @notice Checks whether the given token address is approved for payments (subscription fees)
   * @param token The address of the token to check
   * @return bool True if `token` is approved, false if not
   */
  function isApprovedToken(address token) external view returns (bool);
}
