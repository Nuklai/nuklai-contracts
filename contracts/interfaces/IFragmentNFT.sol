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
     * @notice Adds a batch of Fragments as Pending
     * @param ids Fragments ids to mint
     * @param owners Fragments owners
     * @param tags_ Hashes of tag name of contribution
     * @param signature Signature from a DT service confirming creation of the Fragment
     */
    function proposeMany(uint256[] memory ids, address[] memory owners, bytes32[] memory tags_, bytes calldata signature) external;

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

    /**
     * @notice Calculates a percentage of fragments owned by an account to the total amount of fragments
     * with requested tags
     * @param snapshotId Snapshot to use for calculation
     * @param tags Array of tags to calculate
     * param account Account to calculate
     * @return percentages Array of calculated percentages, 100% = 1e18
     */
    function accountTagPercentageAt(uint256 snapshotId, address account, bytes32[] calldata tags) external view returns(uint256[] memory percentages);
}