// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import '@openzeppelin/contracts/token/ERC721/IERC721.sol';
import './IDatasetLinkInitializable.sol';
import './IDatasetNFT.sol';

/**
 * @title Interface of FragmentNFT implementation contract
 * @notice Defines functions available for users, Dataset NFT token owner (Admin), DistributionManager & VerifierManager contracts
 * @dev Extends IDatasetLinkInitializable` and IERC721
 */
interface IFragmentNFT is IDatasetLinkInitializable, IERC721 {
  /**
   * @notice Retrieves the instance of the DatasetNFT set in the
   * respective instance of the FragmentNFT implementation contract
   */
  function dataset() external returns (IDatasetNFT);

  /**
   * @notice Retrieves the ID of the Dataset NFT token associated with
   * the respective instance of the FragmentNFT implementation contract
   */
  function datasetId() external returns (uint256);

  /**
   * @notice Proposes a specific type of contribution and sets the respetive Fragment as Pending
   * @dev Emits a `FragmentPending` event
   * @param to The address of the contributor
   * @param tag The encoded label (Hash of the contribution's name) indicating the type of contribution
   * @param signature Signature from a DT service confirming the proposal request
   */
  function propose(address to, bytes32 tag, bytes calldata signature) external;

  /**
   * @notice Proposes a batch of contribution types and sets a batch of respective Fragments as Pending
   * @dev Emits `FragmentPending` event(s)
   * @param owners An array containing the addresses of the contributors
   * @param tags_ An array containing the encoded labels (Hash of the contributions' name) indicating the types
   * @param signature Signature from a DT service confirming the proposal request
   */
  function proposeMany(address[] memory owners, bytes32[] memory tags_, bytes calldata signature) external;

  /**
   * @notice Retrieves the current value of `mintCounter` which is associated
   * with the ID of the last pending Fragment.
   * @return uint256 The Id of the last pending Fragment
   */
  function lastFragmentPendingId() external view returns (uint256);

  /**
   * @notice Accepts a specific proposed contribution by minting the respective pending Fragment NFT to contributor
   * @dev Emits a `FragmentAccepted` event
   * @param id The ID of the pending Fragment NFT associated with the proposed contribution to be accepted
   */
  function accept(uint256 id) external;

  /**
   * @notice Rejects a specific proposed contribution by removing the associated pending Fragment NFT
   * @dev Emits a `FragmentRejected` event
   * @param id The ID of the pending Fragment NFT associated with the proposed contribution to be rejected
   */
  function reject(uint256 id) external;

  /**
   * @notice Creates a new snapshot and returns its index
   * @dev Snapshots are created each time a subscription payment event occurs
   * @return uint256 The index of the newly created snapshot
   */
  function snapshot() external returns (uint256);

  /**
   * @notice Retrieves the index of the current (last created) snapshot
   * @return uint256 The index of the current snapshot
   */
  function currentSnapshotId() external view returns (uint256);

  /**
   * @notice Retrieves all the active tags and their counts at a specific snapshot
   * @dev Tags are set by the owner of the Dataset NFT token (see `setTagWeights()` in DatasetNFT).
   * The count of each tag indicates how many times the respective contribution type is incorporated in the Dataset.
   * @param snapshotId The index of the snapshot array targeting a specific snapshot
   * @return tags An array containing the tags (encoded labels for contirbution types)
   * @return counts An array containing the respective counts of the tags
   */
  function tagCountAt(uint256 snapshotId) external view returns (bytes32[] memory tags, uint256[] memory counts);

  /**
   * @notice Retrieves the active tags (and their counts) associated with a specific account at a specific snapshot
   * @dev Tags are set by the owner of the Dataset NFT token (see `setTagWeights()` in DatasetNFT).
   * The count of each tag indicates how many times the respective contribution type is incorporated in the Dataset.
   * The associated account is the owner of the respecitve fragment NFTs.
   * @param snapshotId The index of the snapshot array targeting a specific snapshot
   * @param account The address of the account to inquire
   * @return tags An array containing the tags (encoded labels for contirbution types)
   * @return counts An array containing the respective counts of the tags
   */
  function accountTagCountAt(
    uint256 snapshotId,
    address account
  ) external view returns (bytes32[] memory tags, uint256[] memory counts);

  /**
   * @notice Retrieves the percentages of the specified tags associated with a specific account at a specific snapshot.
   * Tags are set by the owner of the Dataset NFT token (see `setTagWeights()` in DatasetNFT).
   * Each percentage represents how much the `account` has contributed with respect to the associated tag.
   * Percentages are encoded such that 100% is represented as 1e18.
   * @param snapshotId The index of the snapshot array targeting a specific snapshot
   * @param account The address of the account to inquire
   * @param tags An array containing the tags (encoded labels for contirbution types)
   * @return percentages An array containing the respective percentages
   */
  function accountTagPercentageAt(
    uint256 snapshotId,
    address account,
    bytes32[] calldata tags
  ) external view returns (uint256[] memory percentages);
}
