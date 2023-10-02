// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title IVerifier
 * @notice Defines the function for proposing contributions
 */
interface IVerifier {
  /**
   * @notice Adds the pending Fragment ID to the verification queue
   * @dev Emits a {FragmentPending} event.
   * Emits a {FragmentResolved} event on condition.
   * @param fragmentNFT The address of the FragmentNFT contract instance
   * @param id ID of the pending Fragment
   * @param tag The encoded label (Hash of the contribution's name) indicating the type of contribution
   */
  function propose(address fragmentNFT, uint256 id, bytes32 tag) external;
}
