// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./interfaces/IFragmentNFT.sol";
import "./interfaces/IVerifierManager.sol";

contract FragmentNFT is IFragmentNFT, ERC721, Initializable {
    string private constant NAME = "AllianceBlock DataTunel Fragment";
    string private constant SYMBOL = "ABDTF";

    event FragmentPending(uint256 id, bytes32 tag);
    event FragmentAccepted(uint256 id);
    event FragmentRemoved(uint256 id);

    error BAD_SIGNATURE(bytes32 msgHash, address recoveredSigner);
    error NOT_ADMIN(address account);
    error NOT_VERIFIER_MANAGER(address account);

    IDatasetNFT public dataset;
    uint256 public datasetId;
    mapping(uint256 id => address owner) public pendingFragmentOwners;
    mapping(uint256 id => bytes32 tag) public tags;


    modifier onlyAdmin() {
        if(dataset.ownerOf(datasetId) != _msgSender()) revert NOT_ADMIN(_msgSender());
        _;
    }

    modifier onlyVerifierManager() {
        if(dataset.verifierManager(datasetId) != _msgSender()) revert NOT_VERIFIER_MANAGER(_msgSender());
        _;
    }

    constructor() ERC721(NAME, SYMBOL){
        _disableInitializers();
    }


    function initialize(IDatasetNFT dataset_, uint256 datasetId_) external initializer() {
        dataset = dataset_;
        datasetId = datasetId_;
    }

    //TODO handle metadata URI stuff

    /**
     * @notice Adds a Fragment as Pending
     * @param id Fragment id to mint
     * @param to Fragment owner
     * @param tag Hash of tag name of contribution
     * @param signature Signature from a DT service confirming creation of the Fragment
     */
    function propose(uint256 id, address to, bytes32 tag, bytes calldata signature) external {
        bytes32 msgHash = _proposeMessageHash(id, to, tag);
        address signer = ECDSA.recover(msgHash, signature);
        if(!dataset.isSigner(signer)) revert BAD_SIGNATURE(msgHash, signer);
        pendingFragmentOwners[id] = to;
        emit FragmentPending(id, tag);
        
        // Here we call VeriferManager and EXPECT it to call accept() 
        // during this call OR at any following transaction.
        // DO NOT do any state changes after this point!
        IVerifierManager(dataset.verifierManager(datasetId)).propose(this, id, tag);
    }

    function accept(uint256 id) external onlyVerifierManager {
        address to = pendingFragmentOwners[id];
        delete pendingFragmentOwners[id];
        _safeMint(to, id);
        emit FragmentAccepted(id);
    }

    function remove(uint256 id) external onlyAdmin {
        delete pendingFragmentOwners[id]; // in case we are deliting pending one
        delete tags[id];
        _burn(id);
        emit FragmentRemoved(id);
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override(IERC165, ERC721) returns (bool) {
        return interfaceId == type(IFragmentNFT).interfaceId || super.supportsInterface(interfaceId);
    }

    function _proposeMessageHash(uint256 id, address to, bytes32 tag) private view returns(bytes32) {
        return ECDSA.toEthSignedMessageHash(abi.encodePacked(
            block.chainid,
            address(dataset),
            datasetId,
            id,
            to,
            tag
        ));
    }
}