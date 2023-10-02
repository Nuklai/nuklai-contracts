// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "../interfaces/IVerifier.sol";
import "./VerifierManager.sol";

/**
 * @title AcceptManuallyVerifier contract
 * @author Data Tunnel
 * @notice This contract implements a verifier that enables Dataset Owners
 * to manually accept or reject contribution proposals.
 */
contract AcceptManuallyVerifier is IVerifier {
  using EnumerableSet for EnumerableSet.UintSet;

  event FragmentPending(address fragmentNFT, uint256 id);
  event FragmentResolved(address fragmentNFT, uint256 id, bool accept);

  mapping(address fragmentNFT => EnumerableSet.UintSet) internal pendingFragments;

  modifier onlyVerifierManager(address fragmentNFT) {
    address verifierManager = IDatasetNFT(IFragmentNFT(fragmentNFT).dataset()).verifierManager(
      IFragmentNFT(fragmentNFT).datasetId()
    );
    require(verifierManager == msg.sender, "Not a VeriferManager");
    _;
  }

  modifier onlyDatasetOwner(address fragmentNFT) {
    address datasetOwner = IDatasetNFT(IFragmentNFT(fragmentNFT).dataset()).ownerOf(
      IFragmentNFT(fragmentNFT).datasetId()
    );
    require(datasetOwner == msg.sender, "Not a Dataset owner");
    _;
  }

  /**
   * @notice Adds the pending Fragment ID to the verification queue
   * @dev Only callable by the configured VerifierManager contract instance
   * @param fragmentNFT The address of the FragmentNFT contract instance
   * @param id The ID of the pending Fragment
   */
  function propose(address fragmentNFT, uint256 id, bytes32 /*tag*/) external onlyVerifierManager(fragmentNFT) {
    pendingFragments[fragmentNFT].add(id);
    emit FragmentPending(fragmentNFT, id);

    _resolveAutomaticallyIfDSOwner(fragmentNFT, id);
  }

  /**
   * @notice Resolves automatically fragment propose from Dataset Owner
   * @dev Only will be resolved if dataset owner is equal to fragment owner
   * @param fragmentNFT The address of the FragmentNFT contract instance
   * @param id The ID of the pending Fragment
   */
  function _resolveAutomaticallyIfDSOwner(address fragmentNFT, uint256 id) internal {
    address datasetOwner = IDatasetNFT(IFragmentNFT(fragmentNFT).dataset()).ownerOf(
      IFragmentNFT(fragmentNFT).datasetId()
    );
    address fragmentOwner = IFragmentNFT(fragmentNFT).pendingFragmentOwners(id);

    if (datasetOwner == fragmentOwner) {
      VerifierManager vm = VerifierManager(
        IDatasetNFT(IFragmentNFT(fragmentNFT).dataset()).verifierManager(IFragmentNFT(fragmentNFT).datasetId())
      );
      vm.resolve(id, true);
    }
  }

  /**
   * @notice Resolves a single contribution proposal
   * @dev Only callable by the Dataset owner
   * @param fragmentNFT The address of the FragmentNFT contract instance
   * @param id The ID of the pending Fragment associated with the contribution proposal
   * @param accept Flag to indicate acceptance (`true`) or rejection (`true`)
   */
  function resolve(address fragmentNFT, uint256 id, bool accept) external onlyDatasetOwner(fragmentNFT) {
    VerifierManager vm = VerifierManager(
      IDatasetNFT(IFragmentNFT(fragmentNFT).dataset()).verifierManager(IFragmentNFT(fragmentNFT).datasetId())
    );
    vm.resolve(id, accept);
    emit FragmentResolved(fragmentNFT, id, accept);
  }

  /**
   * @notice Resolves a batch of contribution proposals
   * @dev Only callable by the Dataset owner
   * @param fragmentNFT The address of the FragmentNFT contract instance
   * @param ids Array with the IDs of the pending Fragments in the batch
   * @param accept Flag to indicate acceptance (`true`) or rejection (`true`)
   */
  function resolveMany(address fragmentNFT, uint256[] memory ids, bool accept) external onlyDatasetOwner(fragmentNFT) {
    VerifierManager vm = VerifierManager(
      IDatasetNFT(IFragmentNFT(fragmentNFT).dataset()).verifierManager(IFragmentNFT(fragmentNFT).datasetId())
    );
    for (uint256 i; i < ids.length; i++) {
      uint256 id = ids[i];
      vm.resolve(id, accept);
      emit FragmentResolved(fragmentNFT, id, accept);
    }
  }
}
