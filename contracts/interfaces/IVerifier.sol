// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title IVerifier
 * @notice Defines the function for proposing contributions
 */
interface IVerifier {
  /**
   * @notice Adds the fragment ID to the verification queue
   * @param fragmentNFT The address of the FragmentNFT contract instance
   * @param id ID of the fragment
   * @param tag The encoded label (Hash of the contribution's name) indicating the type of contribution
   */
  function propose(address fragmentNFT, uint256 id, bytes32 tag) external;
}
