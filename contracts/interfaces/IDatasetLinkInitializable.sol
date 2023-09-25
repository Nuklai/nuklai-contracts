// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title IDatasetLinkInitializable
 * @notice Interface for setting a link between DatasetNFT contract and given Dataset NFT token,
 * for the corresponding Manager contracts' instances
 */
interface IDatasetLinkInitializable {
  /**
   * @notice Intialization function
   * @dev Sets the address of the DatasetNFT contract and the ID of the Dataset NFT token
   * @param dataset The address of the DatasetNFT contract
   * @param datasetId The ID of the Dataset NFT token
   */
  function initialize(address dataset, uint256 datasetId) external;
}
