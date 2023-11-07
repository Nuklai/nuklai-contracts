// SPDX-License-Identifier: MIT
pragma solidity =0.8.18;

import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {IDatasetNFT} from "../interfaces/IDatasetNFT.sol";
import {IFragmentNFT} from "../interfaces/IFragmentNFT.sol";
import {IVerifier} from "../interfaces/IVerifier.sol";
import {IVerifierManager} from "../interfaces/IVerifierManager.sol";
import {
  ERC2771ContextExternalForwarderSourceUpgradeable
} from "../utils/ERC2771ContextExternalForwarderSourceUpgradeable.sol";

/**
 * @title AcceptManuallyVerifier contract
 * @author Data Tunnel
 * @notice This contract implements a verifier that enables Dataset Owners
 * to manually accept or reject contribution proposals.
 */
contract AcceptManuallyVerifier is IVerifier, ERC2771ContextExternalForwarderSourceUpgradeable {
  using EnumerableSet for EnumerableSet.UintSet;

  error NOT_DATASET_OWNER(address account);
  error NOT_VERIFIER_MANAGER(address account);

  event FragmentPending(address fragmentNFT, uint256 id);
  event FragmentResolved(address fragmentNFT, uint256 id, bool accept);

  IDatasetNFT public dataset;
  mapping(address fragmentNFT => EnumerableSet.UintSet) internal _pendingFragments;

  modifier onlyVerifierManager(address fragmentNFT) {
    address verifierManager = dataset.verifierManager(IFragmentNFT(fragmentNFT).datasetId());
    //We can use msg.sender here instead of _msgSender() because VerifierManager is always a smart-contract
    if (verifierManager != msg.sender) revert NOT_VERIFIER_MANAGER(msg.sender);
    _;
  }

  modifier onlyDatasetOwner(address fragmentNFT) {
    address datasetOwner = dataset.ownerOf(IFragmentNFT(fragmentNFT).datasetId());
    address msgSender = _msgSender();
    if (datasetOwner != msgSender) revert NOT_DATASET_OWNER(msgSender);
    _;
  }

  /**
   * @dev This contract is non-upgradable and constructor
   * needs the initializer modifier to work correctly with ERC-2771 standard upgradability.
   */
  constructor(address _dataset) initializer {
    dataset = IDatasetNFT(_dataset);
    __ERC2771ContextExternalForwarderSourceUpgradeable_init_unchained(_dataset);
  }

  /**
   * @notice Adds the pending Fragment ID to the verification queue
   * @dev Only callable by the configured VerifierManager contract instance
   * Emits a {FragmentPending} event.
   * Emits a {FragmentResolved} event on condition.
   * @param fragmentNFT The address of the FragmentNFT contract instance
   * @param id The ID of the pending Fragment
   */
  function propose(address fragmentNFT, uint256 id, bytes32 /*tag*/) external onlyVerifierManager(fragmentNFT) {
    _pendingFragments[fragmentNFT].add(id);
    emit FragmentPending(fragmentNFT, id);

    _resolveAutomaticallyIfDSOwner(fragmentNFT, id);
  }

  /**
   * @notice Resolves a pending fragment automatically if Dataset Owner proposed it
   * @dev This function automatically accepts a proposed contribution to a Dataset
   * only if the owner of the associated pending Fragment NFT is equal to the Dataset Owner.
   * Emits a {FragmentResolved} event on condition.
   * @param fragmentNFT The address of the FragmentNFT contract instance
   * @param id The ID of the pending Fragment
   */
  function _resolveAutomaticallyIfDSOwner(address fragmentNFT, uint256 id) internal {
    address datasetOwner = dataset.ownerOf(IFragmentNFT(fragmentNFT).datasetId());
    address fragmentOwner = IFragmentNFT(fragmentNFT).pendingFragmentOwners(id);

    if (datasetOwner == fragmentOwner) {
      IVerifierManager vm = IVerifierManager(dataset.verifierManager(IFragmentNFT(fragmentNFT).datasetId()));
      _pendingFragments[fragmentNFT].remove(id);
      vm.resolve(id, true);
      emit FragmentResolved(fragmentNFT, id, true);
    }
  }

  /**
   * @notice Resolves a single contribution proposal
   * @dev Only callable by the Dataset owner.
   * Emits a {FragmentResolved} event.
   * @param fragmentNFT The address of the FragmentNFT contract instance
   * @param id The ID of the pending Fragment associated with the contribution proposal
   * @param accept Flag to indicate acceptance (`true`) or rejection (`true`)
   */
  function resolve(address fragmentNFT, uint256 id, bool accept) external onlyDatasetOwner(fragmentNFT) {
    IVerifierManager vm = IVerifierManager(dataset.verifierManager(IFragmentNFT(fragmentNFT).datasetId()));
    _pendingFragments[fragmentNFT].remove(id);
    vm.resolve(id, accept);
    emit FragmentResolved(fragmentNFT, id, accept);
  }

  /**
   * @notice Resolves a batch of contribution proposals
   * @dev Only callable by the Dataset owner.
   * Emits {FragmentResolved} event(s).
   * @param fragmentNFT The address of the FragmentNFT contract instance
   * @param ids Array with the IDs of the pending Fragments in the batch
   * @param accept Flag to indicate acceptance (`true`) or rejection (`true`)
   */
  function resolveMany(address fragmentNFT, uint256[] memory ids, bool accept) external onlyDatasetOwner(fragmentNFT) {
    IVerifierManager vm = IVerifierManager(dataset.verifierManager(IFragmentNFT(fragmentNFT).datasetId()));
    for (uint256 i; i < ids.length; i++) {
      uint256 id = ids[i];
      _pendingFragments[fragmentNFT].remove(id);
      vm.resolve(id, accept);
      emit FragmentResolved(fragmentNFT, id, accept);
    }
  }
}
