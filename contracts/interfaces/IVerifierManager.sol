// SPDX-License-Identifier: MIT
pragma solidity =0.8.18;

import {IERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/interfaces/IERC165Upgradeable.sol";
import {IDatasetLinkInitializable} from "./IDatasetLinkInitializable.sol";

interface IVerifierManager is IDatasetLinkInitializable, IERC165Upgradeable {
  /**
   * @notice Adds the pending Fragment ID to the verification queue
   * @dev It is expected that `FragmentNFT.accept()` or `FragmentNFT.reject()` will be called by the manager when decision is made
   * @param id ID of the pending Fragment
   * @param tag Tag to verify
   */
  function propose(uint256 id, bytes32 tag) external;

  /**
   * @notice Sets the default verifier
   * @dev Only callable by the Dataset owner
   * The default verifier is invoked during `propose()` & `resolve()` operations targeting tags that have not been
   * explicitly configured by the Dataset Owner (see `setTagVerifier()` & `setTagVerifiers()`)
   * @param defaultVerifier The address of the verifier contract to set as the default verifier
   */
  function setDefaultVerifier(address defaultVerifier) external;

  /**
   * @notice Resolves a single contribution proposal
   * @dev Only callable by the configured Verifier for the associated tag.
   * Emits a {FragmentResolved} event.
   * @param id The ID of the pending Fragment associated with the contribution proposal
   * @param accept Flag to indicate acceptance (`true`) or rejection (`true`)
   */
  function resolve(uint256 id, bool accept) external;
}
