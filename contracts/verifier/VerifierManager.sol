// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {ContextUpgradeable} from '@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol';
import {IDatasetNFT} from '../interfaces/IDatasetNFT.sol';
import {IFragmentNFT} from '../interfaces/IFragmentNFT.sol';
import {IVerifierManager} from '../interfaces/IVerifierManager.sol';
import {IVerifier} from '../interfaces/IVerifier.sol';

/**
 * @title VerifierManager contract
 * @author Data Tunnel
 * @notice Configures and coordinates verifiers for Dataset's proposed contributions,
 * handling approval or rejection operations based on the configured verifiers.
 * This is the implementation contract, and each Dataset (represented by a Dataset NFT token) is associated
 * with a specific instance of this implementation.
 * @dev Extends IVerifierManager, ContextUpgradeable
 */
contract VerifierManager is IVerifierManager, ContextUpgradeable {
  error NOT_DATASET_OWNER(address account);
  error NOT_FRAGMENT_NFT(address account);
  error VERIFIER_WRONG_SENDER(address account);
  error VERIFIER_NOT_SET(address account);
  error ARRAY_LENGTH_MISMATCH();

  event FragmentPending(uint256 id);
  event FragmentResolved(uint256 id, bool accept);

  IDatasetNFT public dataset;
  uint256 public datasetId;
  address public defaultVerifier;
  mapping(bytes32 tag => address verifier) public verifiers;
  mapping(uint256 id => bytes32 tag) internal _pendingFragmentTags;

  modifier onlyDatasetOwner() {
    if (dataset.ownerOf(datasetId) == _msgSender()) revert NOT_DATASET_OWNER(_msgSender());
    _;
  }

  modifier onlyFragmentNFT() {
    if (dataset.fragmentNFT(datasetId) == _msgSender()) revert NOT_FRAGMENT_NFT(_msgSender());
    _;
  }

  constructor() {
    _disableInitializers();
  }

  /**
   * @notice Initializes the VerifierManager contract
   * @param dataset_ The address of the DatasetNFT contract
   * @param datasetId_ The ID of the target Dataset NFT token
   */
  function initialize(address dataset_, uint256 datasetId_) external initializer {
    dataset = IDatasetNFT(dataset_);
    datasetId = datasetId_;
  }

  /**
   * @notice Sets the default verifier
   * @dev Only callable by the Dataset owner
   * The default verifier is invoked during `propose()` & `resolve()` operations targeting tags that have not been
   * explicitly configured by the Dataset Owner (see `setTagVerifier()` & `setTagVerifiers()`)
   * @param defaultVerifier_ The address of the verifier contract to set as the default verifier
   */
  function setDefaultVerifier(address defaultVerifier_) external onlyDatasetOwner {
    defaultVerifier = defaultVerifier_;
  }

  /**
   * @notice Sets a verifier for the specified `tag`
   * @dev Only callable by the Dataset owner
   * @param tag The encoded label (Hash of the contribution's name) indicating the type of contribution
   * that the given verifier should target
   * @param verifier The address of the verifier contract
   */
  function setTagVerifier(bytes32 tag, address verifier) external onlyDatasetOwner {
    verifiers[tag] = verifier;
  }

  /**
   * @notice Sets the verifiers for the respective specified tags
   * @dev Only callable by the Dataset owner
   * @param tags Array with the tags (encoded labels indicating types of contribution) to configure
   * @param verifiers_ Array with the respective addresses of the verifier contracts to set for `tags`
   */
  function setTagVerifiers(bytes32[] calldata tags, address[] calldata verifiers_) external onlyDatasetOwner {
    if (tags.length != verifiers_.length) revert ARRAY_LENGTH_MISMATCH();
    for (uint256 i; i < tags.length; i++) {
      verifiers[tags[i]] = verifiers_[i];
    }
  }

  /**
   * @notice Adds the pending Fragment ID to the verification queue
   * @dev Only callable by the respective FragmentNFT contract instance
   * Emits a {FragmentPending} event.
   * @param id The ID of the pending Fragment
   * @param tag The encoded label (Hash of the contribution's name) indicating the type of contribution
   */
  function propose(uint256 id, bytes32 tag) external onlyFragmentNFT {
    address verifier = _verifierForTag(tag);
    if (verifier == address(0)) revert VERIFIER_NOT_SET(verifier);

    _pendingFragmentTags[id] = tag;
    IVerifier(verifier).propose(_msgSender(), id, tag);
    emit FragmentPending(id);
  }

  /**
   * @notice Resolves a single contribution proposal
   * @dev Only callable by the configured Verifier for the associated tag.
   * Emits a {FragmentResolved} event.
   * @param id The ID of the pending Fragment associated with the contribution proposal
   * @param accept Flag to indicate acceptance (`true`) or rejection (`true`)
   */
  function resolve(uint256 id, bool accept) external {
    bytes32 tag = _pendingFragmentTags[id];
    address verifier = _verifierForTag(tag);
    if (verifier != _msgSender()) revert VERIFIER_WRONG_SENDER(_msgSender());
    IFragmentNFT fragmentNFT = IFragmentNFT(dataset.fragmentNFT(datasetId));
    delete _pendingFragmentTags[id];
    if (accept) {
      fragmentNFT.accept(id);
    } else {
      fragmentNFT.reject(id);
    }
    emit FragmentResolved(id, accept);
  }

  /**
   * @notice Retrieves the address of the verifier contract associated with the specified `tag`
   * @param tag The encoded label (Hash of the contribution's name) indicating the type of contribution,
   * to inquire about
   * @return verifier The address of the verifier contract associated with the specified `tag`
   */
  function _verifierForTag(bytes32 tag) internal view returns (address verifier) {
    verifier = verifiers[tag];
    if (verifier == address(0) && defaultVerifier != address(0)) {
      verifier = defaultVerifier;
    }
  }
}
