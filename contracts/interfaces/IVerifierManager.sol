// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IDatasetLinkInitializable} from "./IDatasetLinkInitializable.sol";

interface IVerifierManager is IDatasetLinkInitializable {
  /**
   * @notice Adds the pending Fragment ID to the verification queue
   * @dev It is expected that `FragmentNFT.accept()` or `FragmentNFT.reject()` will be called by the manager when decision is made
   * @param id ID of the pending Fragment
   * @param tag Tag to verify
   */
  function propose(uint256 id, bytes32 tag) external;
}
