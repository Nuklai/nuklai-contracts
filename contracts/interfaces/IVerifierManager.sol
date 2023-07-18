// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./IDatasetLinkInitializable.sol";
import "./IFragmentNFT.sol";

interface IVerifierManager /*is IDatasetLinkInitializable */{

    /**
     * @notice Should 
     * @param fragmentNFT Fragment contract dedicated to the dataset
     * @param id Id of the fragment
     * @param tag Tag to verify
     */
    function propose(IFragmentNFT fragmentNFT, uint256 id, bytes32 tag) external;
}