// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "./IDatasetLinkInitializable.sol";
import "./IDatasetNFT.sol";

interface IFragmentNFT is IDatasetLinkInitializable, IERC721 {

    function dataset() external returns(IDatasetNFT);
    function datasetId() external returns(uint256);

    /**
     * @notice Adds a Fragment as Pending
     * @param id Fragment id to mint
     * @param to Fragment owner
     * @param tag Hash of tag name of contribution
     * @param signature Signature from a DT service confirming creation of the Fragment
     */
    function propose(uint256 id, address to, bytes32 tag, bytes calldata signature) external;

    /**
     * @notice Approve fragment as verified
     * @dev This function should be called by VerifierManager
     * @param id of the fragment
     */
    function accept(uint256 id) external;

    /**
     * @notice Rejects the fragment (verification failed)
     * @dev This function should be called by VerifierManager
     * @param id of the fragment
     */
    function reject(uint256 id) external;

    /**
     * @notice Creates a Snapshot of:
     * - count of existing ids for each tag
     * - count of existing ids per tag per address
     * @return id of created Snapshot
     */
    function snapshot() external returns(uint256);

    /**
     * @return id of "current" snapshot
     */
    function currentSnapshotId() external view returns(uint256);

    /**
     * @notice Get tag count at snapshot
     * @param snapshotId Snapshot id
     */
    function tagCountAt(uint256 snapshotId) external view returns(bytes32[] memory tags, uint256[] memory counts);

    /**
     * @notice Get tag count at snapshot for account
     * @param snapshotId Snapshot id
     */
    function accountTagCountAt(uint256 snapshotId, address account) external view returns(bytes32[] memory tags, uint256[] memory counts);
}