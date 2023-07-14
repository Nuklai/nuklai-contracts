// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./IDatasetLinkInitializable.sol";
import "./IFragmentNFT.sol";

interface IVerifierManager is IDatasetLinkInitializable {

    /**
     * @notice Should 
     * @param fragmentNFT Fragment contract dedicated to the dataset
     * @param tag Tag to verify
     * @param id Id of the fragment
     */
    function verify(IFragmentNFT fragmentNFT, bytes32 tag, uint256 id) external;
}