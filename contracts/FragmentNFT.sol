// SPDX-License-Identifier: MIT
pragma solidity =0.8.18;

import {IERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/interfaces/IERC165Upgradeable.sol";
import {ERC721Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import {ContextUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EnumerableMap} from "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";
import {Arrays} from "@openzeppelin/contracts/utils/Arrays.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IDatasetNFT} from "./interfaces/IDatasetNFT.sol";
import {IFragmentNFT} from "./interfaces/IFragmentNFT.sol";
import {IVerifierManager} from "./interfaces/IVerifierManager.sol";
import {
  ERC2771ContextExternalForwarderSourceUpgradeable
} from "./utils/ERC2771ContextExternalForwarderSourceUpgradeable.sol";

/**
 * @title FragmentNFT contract
 * @author Nuklai
 * @notice This contract mints ERC721 tokens, called Fragments, to contributors,
 * and maintains a record of its state at each subscription payment event.
 * Each Fragment NFT represents an incorporated contribution to the linked Dataset and
 * is associated with a specific tag, indicating the contribution type.
 * This is the implementation contract, and each Dataset (represented by a Dataset NFT token) is associated
 * with a specific instance of this implementation.
 */
contract FragmentNFT is IFragmentNFT, ERC721Upgradeable, ERC2771ContextExternalForwarderSourceUpgradeable {
  using EnumerableMap for EnumerableMap.Bytes32ToUintMap;
  using Arrays for uint256[];
  using Strings for uint256;

  string private constant _NAME = "Nuklai Fragment";
  string private constant _SYMBOL = "NAIF";

  event FragmentPending(uint256 id, bytes32 tag);
  event FragmentAccepted(uint256 id);
  event FragmentRejected(uint256 id);
  event FragmentRemoved(uint256 id);

  error TOKEN_ID_NOT_EXISTS(uint256 tokenId);
  error BAD_SIGNATURE(bytes32 msgHash, address recoveredSigner);
  error BAD_SNAPSHOT_ID(uint256 currentId, uint256 targetId);
  error NOT_DATASET_OWNER(address account);
  error NOT_VERIFIER_MANAGER(address account);
  error NOT_DISTRIBUTION_MANAGER(address account);
  error NOT_DATASET_NFT(address account);
  error NOT_PENDING_FRAGMENT(uint256 id);
  error ARRAY_LENGTH_MISMATCH();
  error MINT_COUNTER_MISMATCH();
  error TARGET_NOT_EMPTY();
  error ZERO_ADDRESS();

  /**
   * @dev A Snapshot contains:
   *  - count of existing ids for each tag
   *  - count of existing ids per tag per address
   */
  struct Snapshot {
    EnumerableMap.Bytes32ToUintMap totalTagCount;
    mapping(address account => EnumerableMap.Bytes32ToUintMap) accountTagCount;
  }

  IDatasetNFT public dataset;
  uint256 public datasetId;
  uint256 internal _mintCounter;
  mapping(uint256 id => address owner) public pendingFragmentOwners;
  mapping(uint256 id => bytes32 tag) public tags;
  Snapshot[] internal _snapshots;
  mapping(address account => uint256[]) internal _accountSnapshotIds; // ids of snapshots which contains account data

  modifier onlyDatasetOwner() {
    address msgSender = _msgSender();
    if (dataset.ownerOf(datasetId) != msgSender) revert NOT_DATASET_OWNER(msgSender);
    _;
  }

  modifier onlyVerifierManager() {
    address msgSender = _msgSender();
    if (dataset.verifierManager(datasetId) != msgSender) revert NOT_VERIFIER_MANAGER(msgSender);
    _;
  }

  modifier onlyDistributionManager() {
    address msgSender = _msgSender();
    if (dataset.distributionManager(datasetId) != msgSender) revert NOT_DISTRIBUTION_MANAGER(msgSender);
    _;
  }

  modifier onlyDatasetNFT() {
    //Use msg.sender here instead of _msgSender() because this call should not go through trustedForwarder
    if (address(dataset) != msg.sender) revert NOT_DATASET_NFT(msg.sender);
    _;
  }

  /// @custom:oz-upgrades-unsafe-allow constructor
  constructor() {
    _disableInitializers();
  }

  /**
   * @notice Initializes the FragmentNFT contract
   * @dev Sets the name & symbol of the token collection
   * @param dataset_ The address of the DatasetNFT contract
   * @param datasetId_ The ID of the target Dataset NFT token
   */
  function initialize(address dataset_, uint256 datasetId_) external initializer {
    __ERC721_init(_NAME, _SYMBOL);
    __ERC2771ContextExternalForwarderSourceUpgradeable_init(dataset_);
    dataset = IDatasetNFT(dataset_);
    datasetId = datasetId_;
    _snapshots.push();
    _snapshots.push();
  }

  /**
   * @notice Retrieves the contract URI for FragmentNFT
   * @return string The URI of the contract
   */
  function contractURI() public view returns (string memory) {
    return _contractURI();
  }

  /**
   * @notice Retrieves the Uniform Resource Identifier (URI) for the `tokenId` Fragment NFT token
   * @dev If DatasetNFT `baseURI` is set, it returns the concatenation of `contractURI` and `tokenId`.
   * If DatasetNFT `baseURI` is not set, it returns an empty string.
   * @param tokenId The ID of the target Fragment NFT token
   * @return string The requested URI
   */
  function tokenURI(uint256 tokenId) public view override returns (string memory) {
    if (!_exists(tokenId)) revert TOKEN_ID_NOT_EXISTS(tokenId);
    string memory contractURI_ = _contractURI();
    return bytes(contractURI_).length > 0 ? string.concat(string.concat(contractURI_, "/"), tokenId.toString()) : "";
  }

  /**
   * @notice Returns the DatasetNFT `baseURI`
   * @return string The base URI of DatasetNFT
   */
  function _baseURI() internal view override returns (string memory) {
    return dataset.tokenURI(datasetId);
  }

  /**
   * @notice Returns the contract URI for FragmentNFT
   * @dev If DatasetNFT `baseURI` is set, it returns the concatenation of `baseURI` and `suffix`.
   * If DatasetNFT `baseURI` is not set, it returns an empty string.
   * @return string The contract URI
   */
  function _contractURI() internal view returns (string memory) {
    string memory suffix = "fragments";
    string memory base = _baseURI();
    return bytes(base).length > 0 ? string.concat(string.concat(base, "/"), suffix) : "";
  }

  /**
   * @notice Creates a new snapshot and returns its index
   * @dev Snapshots are created each time a subscription payment event occurs
   * (see `SubscriptionManager` & `DistributionManager`)
   * _currentSnapshotId() returns the index of `Snapshot` struct where data for next snapshot is stored.
   * And we have to retutrn index of the Snapshot with current data, which will not be modified later
   * Only callable by `DistributionManager`
   * @return uint256 The index of the newly created snapshot
   */
  function snapshot() external onlyDistributionManager returns (uint256) {
    _snapshots.push();
    return _currentSnapshotId() - 1;
  }

  /**
   * @notice Retrieves the index of the current (last created) snapshot
   * @dev Snapshots are created each time a subscription payment event occurs
   * @return uint256 The index of the current snapshot
   */
  function currentSnapshotId() external view returns (uint256) {
    return _currentSnapshotId();
  }

  /**
   * @notice Retrieves all the active tags and their counts at a specific snapshot
   * @dev Tags are set by the owner of the Dataset NFT token (see `setTagWeights()` in DatasetNFT).
   * The count of each tag indicates how many times the respective contribution type is incorporated in the Dataset.
   * @param snapshotId The index of the snapshot array targeting a specific snapshot
   * @return tags_ An array containing the tags (encoded labels for contirbution types)
   * @return counts An array containing the respective counts of the tags
   */
  function tagCountAt(uint256 snapshotId) external view returns (bytes32[] memory tags_, uint256[] memory counts) {
    if (snapshotId >= _snapshots.length) revert BAD_SNAPSHOT_ID(snapshotId, _snapshots.length);
    EnumerableMap.Bytes32ToUintMap storage tagCount = _snapshots[snapshotId].totalTagCount;
    tags_ = tagCount.keys();

    uint256 length = tagCount.length();
    counts = new uint256[](length);

    for (uint256 i; i < length; ) {
      counts[i] = tagCount.get(tags_[i]);
      unchecked {
        i++;
      }
    }
  }

  /**
   * @notice Retrieves the active tags (and their counts) associated with a specific account at a specific snapshot
   * @dev Tags are set by the owner of the Dataset NFT token (see `setTagWeights()` in DatasetNFT).
   * The count of each tag indicates how many times the respective contribution type is incorporated in the Dataset.
   * The associated account is the owner of the respecitve fragment NFTs.
   * @param snapshotId The index of the snapshot array targeting a specific snapshot
   * @param account The address of the account to inquire
   * @return tags_ An array containing the tags (encoded labels for contirbution types)
   * @return counts An array containing the respective counts of the tags
   */
  function accountTagCountAt(
    uint256 snapshotId,
    address account
  ) external view returns (bytes32[] memory tags_, uint256[] memory counts) {
    if (snapshotId >= _snapshots.length) revert BAD_SNAPSHOT_ID(snapshotId, _snapshots.length);
    EnumerableMap.Bytes32ToUintMap storage tagCount = _snapshots[_findAccountSnapshotId(account, snapshotId)]
      .accountTagCount[account];
    uint256 totalTagCount = tagCount.length();
    tags_ = tagCount.keys();
    counts = new uint256[](totalTagCount);
    for (uint256 i; i < totalTagCount; ) {
      counts[i] = tagCount.get(tags_[i]);
      unchecked {
        i++;
      }
    }
  }

  /**
   * @notice Retrieves the percentages of the specified tags associated with a specific account at a specific snapshot.
   * Tags are set by the owner of the Dataset NFT token (see `setTagWeights()` in DatasetNFT).
   * Each percentage represents how much the `account` has contributed with respect to the associated tag.
   * Percentages are encoded such that 100% is represented as 1e18.
   * @param snapshotId The index of the snapshot array targeting a specific snapshot
   * @param account The address of the account to inquire
   * @param tags_ An array containing the tags (encoded labels for contirbution types)
   * @return percentages An array containing the respective percentages
   */
  function accountTagPercentageAt(
    uint256 snapshotId,
    address account,
    bytes32[] calldata tags_
  ) external view returns (uint256[] memory percentages) {
    if (snapshotId >= _snapshots.length) revert BAD_SNAPSHOT_ID(snapshotId, _snapshots.length);
    uint256 totalTags = tags_.length;
    uint256 latestTotalSnapshot = _findAccountSnapshotId(address(this), snapshotId);
    uint256 latestAccountSnapshot = _findAccountSnapshotId(account, snapshotId);
    EnumerableMap.Bytes32ToUintMap storage totalTagCount = _snapshots[latestTotalSnapshot].totalTagCount;
    EnumerableMap.Bytes32ToUintMap storage accountTagCount = _snapshots[latestAccountSnapshot].accountTagCount[account];
    percentages = new uint256[](totalTags);

    for (uint256 i; i < totalTags; ) {
      bytes32 tag = tags_[i];
      (, uint256 totalCount) = totalTagCount.tryGet(tag);
      if (totalCount != 0) {
        (, uint256 accountCount) = accountTagCount.tryGet(tag);
        percentages[i] = (1e18 * accountCount) / totalCount;
      }
      // else:  percentages[i] = 0, but we skip it because percentages are initialized with zeroes
      unchecked {
        i++;
      }
    }
  }

  /**
   * @notice Proposes a specific type of contribution and sets the respetive Fragment as Pending
   * @dev Only callable by DatasetNFT contract.
   * Emits a {FragmentPending} event.
   * @param to The address of the contributor
   * @param tag The encoded label (Hash of the contribution's name) indicating the type of contribution
   * @param signature Signature from a DT service confirming the proposal request
   */
  function propose(address to, bytes32 tag, bytes calldata signature) external onlyDatasetNFT {
    if (to == address(0)) revert ZERO_ADDRESS();

    uint256 id = ++_mintCounter;
    bytes32 msgHash = _proposeMessageHash(id, to, tag);
    address signer = ECDSA.recover(msgHash, signature);
    if (!dataset.isSigner(signer)) revert BAD_SIGNATURE(msgHash, signer);
    pendingFragmentOwners[id] = to;
    tags[id] = tag;
    emit FragmentPending(id, tag);

    // Here we call VeriferManager and EXPECT it to call accept()
    // during this call OR at any following transaction.
    // DO NOT implement any state changes after this point!
    IVerifierManager(dataset.verifierManager(datasetId)).propose(id, tag);
  }

  /**
   * @notice Proposes a batch of contribution types and sets a batch of respective Fragments as Pending
   * @dev Only callable by DatasetNFT contract.
   * Emits {FragmentPending} event(s).
   * @param owners An array containing the addresses of the contributors
   * @param tags_ An array containing the encoded labels (Hash of the contributions' name) indicating the types
   * @param signature Signature from a DT service confirming the proposal request
   */
  function proposeMany(
    address[] calldata owners,
    bytes32[] calldata tags_,
    bytes calldata signature
  ) external onlyDatasetNFT {
    if (tags_.length != owners.length) revert ARRAY_LENGTH_MISMATCH();
    bytes32 msgHash = _proposeManyMessageHash(_mintCounter + 1, _mintCounter + tags_.length, owners, tags_);
    address signer = ECDSA.recover(msgHash, signature);
    if (!dataset.isSigner(signer)) revert BAD_SIGNATURE(msgHash, signer);

    uint256 skippedOwners;
    uint256 totalOwners = owners.length;
    uint256 lastMintCounter = _mintCounter;
    for (uint256 i; i < totalOwners; ) {
      address owner = owners[i];
      if (owner == address(0)) {
        unchecked {
          i++;
          skippedOwners++;
        }
        continue;
      }

      uint256 id = ++_mintCounter;
      bytes32 tag = tags_[i];
      pendingFragmentOwners[id] = owner;
      tags[id] = tag;
      emit FragmentPending(id, tag);

      // Here we call VeriferManager and EXPECT it to call `accept()`
      // during this call OR at any following transaction.
      // DO NOT implement any state changes after this point!
      IVerifierManager(dataset.verifierManager(datasetId)).propose(id, tag);

      unchecked {
        i++;
      }
    }
    if (lastMintCounter + tags_.length - skippedOwners != _mintCounter) revert MINT_COUNTER_MISMATCH();
  }

  /**
   * @notice Retrieves the current value of `_mintCounter` which is associated
   * with the ID of the last pending Fragment.
   * @return uint256 The ID of the last pending Fragment
   */
  function lastFragmentPendingId() external view returns (uint256) {
    return _mintCounter;
  }

  /**
   * @notice Accepts a specific proposed contribution by minting the respective pending Fragment NFT to contributor
   * @dev Only callable by VerifierManager contract.
   * Emits a {FragmentAccepted} event.
   * @param id The ID of the pending Fragment NFT associated with the proposed contribution to be accepted
   */
  function accept(uint256 id) external onlyVerifierManager {
    address to = pendingFragmentOwners[id];
    if (_exists(id) || to == address(0)) revert NOT_PENDING_FRAGMENT(id);
    delete pendingFragmentOwners[id];
    _safeMint(to, id);
    emit FragmentAccepted(id);
  }

  /**
   * @notice Rejects a specific proposed contribution by removing the associated pending Fragment NFT
   * @dev Only callable by VerifierManager contract.
   * Emits a {FragmentRejected} event.
   * @param id The ID of the pending Fragment NFT associated with the proposed contribution to be rejected
   */
  function reject(uint256 id) external onlyVerifierManager {
    address to = pendingFragmentOwners[id];
    if (_exists(id) || to == address(0)) revert NOT_PENDING_FRAGMENT(id);
    delete pendingFragmentOwners[id];
    delete tags[id];
    emit FragmentRejected(id);
  }

  /**
   * @notice Removes a contribution which is either:
   *  - already incorporated
   *  - or pending to be accepted - rejected
   * @dev Either removes an already accepted contribution by burning the associated Fragment NFT,
   * or rejects a specific proposed contribution by removing the associated pending Fragment NFT.
   * Only callable by the Dataset owner.
   * Emits a {FragmentRemoved} event.
   * @param id The ID of the Fragment NFT (pending or already minted) associated with the contribution to be removed
   */
  function remove(uint256 id) external onlyDatasetOwner {
    delete pendingFragmentOwners[id]; // in case we are deleting pending one
    if (_exists(id)) _burn(id);
    delete tags[id];
    emit FragmentRemoved(id);
  }

  /**
   * @notice Removes multiple contributions which are either:
   *  - already incorporated
   *  - or pending to be accepted - rejected
   * @dev Either removes an already accepted contribution by burning the associated Fragment NFT,
   * or rejects a specific proposed contribution by removing the associated pending Fragment NFT.
   * Only callable by the Dataset owner.
   * Emits a {FragmentRemoved} event.
   * @param ids Array of the IDs of the Fragment NFTs (pending or already minted) associated with the contributions to be removed
   */
  function removeMany(uint256[] calldata ids) external onlyDatasetOwner {
    uint256 totalIds = ids.length;
    for (uint256 i; i < totalIds; ) {
      uint256 id = ids[i];
      delete pendingFragmentOwners[id]; // in case we are deleting pending one
      if (_exists(id)) _burn(id);
      delete tags[id];
      emit FragmentRemoved(id);

      unchecked {
        i++;
      }
    }
  }

  /**
   * @notice Checks whether the interface ID provided is supported by this Contract
   * @dev For more information, see `EIP-165`
   * @param interfaceId The interface ID to check
   * @return bool true if it is supported, false if it is not
   */
  function supportsInterface(
    bytes4 interfaceId
  ) public view virtual override(IERC165Upgradeable, ERC721Upgradeable) returns (bool) {
    return interfaceId == type(IFragmentNFT).interfaceId || super.supportsInterface(interfaceId);
  }

  /**
   * @notice Internal before token transfer function
   * @dev Handles any necessary checks and updates respectively the associated snapshots
   * @param from Sender of the Fragment NFT token(s)
   * @param to Receiver of the Fragment NFT token(s)
   * @param firstTokenId The ID of the first Fragment NFT token in the batch
   * @param batchSize Number of Fragment NFT tokens being transferred in the batch
   */
  function _beforeTokenTransfer(address from, address to, uint256 firstTokenId, uint256 batchSize) internal override {
    super._beforeTokenTransfer(from, to, firstTokenId, batchSize);

    // Update snapshot data
    if (from != address(0)) {
      _updateAccountSnapshot(from, firstTokenId, batchSize, false);
    } else {
      // Mint
      _updateTotalSnapshot(firstTokenId, batchSize, true);
    }

    if (to != address(0)) {
      _updateAccountSnapshot(to, firstTokenId, batchSize, true);
    } else {
      // Burn
      _updateTotalSnapshot(firstTokenId, batchSize, false);
    }
  }

  /**
   * @notice Updates the account-specific tag counts for a batch of Fragment NFT tokens
   * @dev This function is used to record changes in the counts of different tags associated with a specific account
   * during the respective Fragment NFT tokens transfer operations.
   * @param account The address of the account for which the respective tag counts are updated
   * @param firstTokenId The ID of the first Fragment NFT token in the batch
   * @param batchSize Number of Fragment NFT tokens in the batch
   * @param add A boolean flag indicating whether to increase (`add`) or decrease (`false`) the tag counts
   */
  function _updateAccountSnapshot(address account, uint256 firstTokenId, uint256 batchSize, bool add) private {
    uint256 currentSnapshot = _currentSnapshotId();
    EnumerableMap.Bytes32ToUintMap storage currentAccountTagCount = _snapshots[currentSnapshot].accountTagCount[
      account
    ];
    uint256[] storage accountSnapshotIds = _accountSnapshotIds[account];
    uint256 lastAccountSnapshot = _lastUint256ArrayElement(accountSnapshotIds);
    if (lastAccountSnapshot < currentSnapshot) {
      _copy(_snapshots[lastAccountSnapshot].accountTagCount[account], currentAccountTagCount);
      accountSnapshotIds.push(currentSnapshot);
    }
    for (uint256 i; i < batchSize; ) {
      uint256 id = firstTokenId + i;
      bytes32 tag = tags[id];
      (, uint256 currentCount) = currentAccountTagCount.tryGet(tag);
      currentAccountTagCount.set(tag, add ? (currentCount + 1) : (currentCount - 1));

      unchecked {
        i++;
      }
    }
  }

  /**
   * @notice Updates the total counts of tags associated with a batch of Fragment NFT tokens
   * @dev This function is used to record changes in the counts of associated tags during
   * minting and burning of Fragment NFT tokens.
   * @param firstTokenId The ID of the first Fragment NFT token in the batch
   * @param batchSize Number of Fragment NFT tokens in the batch
   * @param add A boolean flag indicating whether to increase (`true`) i.e minting operation,
   * or decrease (`false`) i.e burning operation, the tag counts
   */
  function _updateTotalSnapshot(uint256 firstTokenId, uint256 batchSize, bool add) private {
    uint256 currentSnapshot = _currentSnapshotId();
    EnumerableMap.Bytes32ToUintMap storage totalTagCount = _snapshots[currentSnapshot].totalTagCount;
    uint256[] storage accountSnapshotIds = _accountSnapshotIds[address(this)];
    uint256 lastSnapshot = _lastUint256ArrayElement(accountSnapshotIds);
    if (lastSnapshot < currentSnapshot) {
      _copy(_snapshots[lastSnapshot].totalTagCount, totalTagCount);
      accountSnapshotIds.push(currentSnapshot);
    }
    for (uint256 i; i < batchSize; ) {
      uint256 id = firstTokenId + i;
      bytes32 tag = tags[id];
      (, uint256 currentCount) = totalTagCount.tryGet(tag);
      totalTagCount.set(tag, add ? (currentCount + 1) : (currentCount - 1));
      unchecked {
        i++;
      }
    }
  }

  /**
   * @notice Retrieves the closest matching snapshot index based on the specified `targetSnapshotId` index
   * and the available snapshots for a given account.
   * @param account The address of the account for which to find the snapshot index
   * @param targetSnapshotId The target snapshot index to match or locate
   * @return uint256 The closest matching snapshot index or 0 if no account-specific snapshot is found
   */
  function _findAccountSnapshotId(address account, uint256 targetSnapshotId) private view returns (uint256) {
    uint256[] storage snapshotIds = _accountSnapshotIds[account];
    uint256 bound = snapshotIds.findUpperBound(targetSnapshotId);
    if (bound == snapshotIds.length) {
      // no snapshot id was found equal or greater to the targetSnapshotId
      // we need to return the last available
      // if there is no snapshot at all - return current,
      // otherwise return the last one
      unchecked {
        return (bound == 0) ? _currentSnapshotId() : snapshotIds[bound - 1];
      }
    } else {
      // found snapshot id which is greater or equal to the targetSnapshotId
      // if it is equal to target, we need to return it,
      // otherwise we need to return previous
      uint256 found = snapshotIds[bound];
      if (found == targetSnapshotId) {
        // we've found the exact snapshot we need
        return targetSnapshotId;
      } else {
        if (bound == 0) {
          //there is no previous snapshot
          return 0; // return empty snapshot
        } else {
          // return last snapshot before the one we've found
          unchecked {
            return snapshotIds[bound - 1];
          }
        }
      }
    }
  }

  /**
   * @notice Private function that retrieves the index of the current (last created) snapshot
   * @return uint256 The index of the current snapshot
   */
  function _currentSnapshotId() private view returns (uint256) {
    return _snapshots.length - 1;
  }

  /**
   * @notice Returns an Ethereum Signed Message hash for proposing a specific contribution type
   * @param id The ID of the pending Fragment NFT associated with the proposed contribution
   * @param to The address of the contributor
   * @param tag The encoded label (Hash of the contribution's name) indicating the type of contribution
   * @return bytes32 The generated Ethereum signed message hash
   */
  function _proposeMessageHash(uint256 id, address to, bytes32 tag) private view returns (bytes32) {
    return ECDSA.toEthSignedMessageHash(abi.encodePacked(block.chainid, address(dataset), datasetId, id, to, tag));
  }

  /**
   * @notice Returns an Ethereum Signed Message hash for proposing a batch of specified contribution types
   * @param fromId The first pending Fragment NFT ID in the batch (associated with the first proposal)
   * @param toId The last pending Fragment NFT ID in the batch (associated with the last proposal)
   * @param owners An array containing the addresses of the respective contributors
   * @param tags_ An array containing the encoded labels (Hash of the contributions' name) indicating the types
   * @return bytes32 The generated Ethereum signed message hash
   */
  function _proposeManyMessageHash(
    uint256 fromId,
    uint256 toId,
    address[] memory owners,
    bytes32[] memory tags_
  ) private view returns (bytes32) {
    return
      ECDSA.toEthSignedMessageHash(
        abi.encodePacked(block.chainid, address(dataset), datasetId, fromId, owners, toId, tags_)
      );
  }

  /**
   * @notice Copies key-value pairs from one `EnumerableMap.Bytes32ToUintMap` storage to another
   * @dev Ensures that the target map is initially empty to prevent data overwriting
   * @param from The source map from which key-value pairs are copied
   * @param to The target map where key-value pairs are copied to
   */
  function _copy(EnumerableMap.Bytes32ToUintMap storage from, EnumerableMap.Bytes32ToUintMap storage to) private {
    if (to.length() != 0) revert TARGET_NOT_EMPTY();
    uint256 length = from.length();
    for (uint256 i; i < length; ) {
      (bytes32 k, uint256 v) = from.at(i);
      to.set(k, v);
      unchecked {
        i++;
      }
    }
  }

  /**
   * @notice Retrieves the last element from a dynamic unsigned integer array
   * @dev If the target array is empty, it initializes it with a single element (uint256(0)) before returning
   * @param arr The dynamic integer array from which to retrieve the last element
   * @return uint256 The value of the last element in the array
   */
  function _lastUint256ArrayElement(uint256[] storage arr) private view returns (uint256) {
    if (arr.length == 0) return 0;

    unchecked {
      return arr[arr.length - 1];
    }
  }

  function _msgSender()
    internal
    view
    virtual
    override(ContextUpgradeable, ERC2771ContextExternalForwarderSourceUpgradeable)
    returns (address sender)
  {
    return ERC2771ContextExternalForwarderSourceUpgradeable._msgSender();
  }

  function _msgData()
    internal
    view
    virtual
    override(ContextUpgradeable, ERC2771ContextExternalForwarderSourceUpgradeable)
    returns (bytes calldata)
  {
    return ERC2771ContextExternalForwarderSourceUpgradeable._msgData();
  }
}
