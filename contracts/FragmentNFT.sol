// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./interfaces/IFragmentNFT.sol";

contract FragmentNFT is IFragmentNFT, ERC721, Initializable {
    string private constant NAME = "AllianceBlock DataTunel Fragment";
    string private constant SYMBOL = "ABDTF";

    event FragmentPending(uint256 id);
    event FragmentAccepted(uint256 id, uint256 parent, bytes32 tag);
    event FragmentDeclined(uint256 id);

    error BAD_SIGNATURE(bytes32 msgHash, address recoveredSigner);
    error NOT_ADMIN(address account);

    struct PendingFragment {
        address to; 
        uint256 parent;
        bytes32 tag;
        bytes signature;
    }


    IDatasetNFT public dataset;
    uint256 public datasetId;
    mapping(uint256 id => PendingFragment fragment) public pendingFragments;
    mapping(uint256 id => uint256 parent) public parents;
    mapping(uint256 id => bytes32 tag) public tags;


    modifier onlyAdmin() {
        if(dataset.ownerOf(datasetId) != _msgSender()) revert NOT_ADMIN(_msgSender());
        _;
    }

    modifier onlyVerifier() {
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
     * @param parent Id of parent Fragment or 0 if no parent
     * @param tag Hash of tag name of contribution
     * @param signature Signature from a DT service confirming creation of the Fragment
     */
    function propose(uint256 id, address to, uint256 parent, bytes32 tag, bytes calldata signature) external {
        bytes32 msgHash = _mintMessageHash(id, to);
        address signer = ECDSA.recover(msgHash, signature);
        if(!dataset.isSigner(signer)) revert BAD_SIGNATURE(msgHash, signer);
        _mint(to, id);
        parents[id] = parent;
        emit FragmentPending(id, parent);
    }

    function accept(uint256 id) external onlyVerifier {

    }

    function remove(uint256 id) external onlyAdmin {

    }

    function findVerifier(bytes32 tag, uint256 parent) {
        
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override(IERC165, ERC721) returns (bool) {
        return interfaceId == type(IFragmentNFT).interfaceId || super.supportsInterface(interfaceId);
    }

    function _mintMessageHash(uint256 id, address to, uint256 parent) private pure returns(bytes32) {
        return ECDSA.toEthSignedMessageHash(abi.encodePacked(
            block.chainid,
            address(this),
            datasetId,
            id,
            to,
            parent
        ));
    }
}