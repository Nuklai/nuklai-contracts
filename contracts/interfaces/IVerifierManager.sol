// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import './IDatasetLinkInitializable.sol';
import './IFragmentNFT.sol';

interface IVerifierManager is IDatasetLinkInitializable {
  /**
   * @notice Adds the fragment id to the verification queue
   * @dev it's expected that `fragmentNFT.accept()` or `fragmentNFT.reject()` will be called by the manager when decision is made
   * @param id Id of the fragment
   * @param tag Tag to verify
   */
  function propose(uint256 id, bytes32 tag) external;
}
