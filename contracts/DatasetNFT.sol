// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "./interfaces/IDistributionManager.sol";
import "./interfaces/ISubscriptionManager.sol";
import "./interfaces/IVerifierManager.sol";
import "./interfaces/IDatasetNFT.sol";
import "./interfaces/IFragmentNFT.sol";

contract DatasetNFT is IDatasetNFT, ERC721, AccessControl {
    string private constant NAME = "AllianceBlock DataTunel Dataset";
    string private constant SYMBOL = "ABDTDS";

    bytes32 public constant SIGNER_ROLE = keccak256("SIGNER_ROLE");

    error NOT_OWNER(uint256 id, address account);
    error BAD_SIGNATURE(bytes32 msgHash, address recoveredSigner);

    event ManagersConfigChange(uint256 id);
    event FragmentInstanceDeployement(uint256 id, address instance);




    address public fragmentImplementation;
    mapping(uint256 id => ManagersConfig config) public configurations;
    mapping(uint256 id => ManagersConfig proxy) public proxies;
    mapping(uint256 id => IFragmentNFT fragment) public fragments;

    modifier onlyTokenOwner(uint256 id) {
        if(_ownerOf(id) != _msgSender()) revert NOT_OWNER(id, _msgSender());
        _;
    }

    constructor() ERC721(NAME, SYMBOL){
        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
    }

    //TODO handle metadata URI stuff

    /**
     * @notice Mints a Dataset NFT
     * @param id Token id to mint
     * @param to Dataset admin
     * @param signature Signature from a DT service confirming creation of Dataset
     */
    function mint(uint256 id, address to, bytes calldata signature) external {
        bytes32 msgHash = _mintMessageHash(id, to);
        address signer = ECDSA.recover(msgHash, signature);
        if(!hasRole(SIGNER_ROLE, signer)) revert BAD_SIGNATURE(msgHash, signer);
        _mint(to, id);
    }


    function setManagers(uint256 id, DatasetConfig calldata config) external onlyTokenOwner(id)  {
        if(configurations[id].subscriptionManager != config.subscriptionManager) {
            proxies.subscriptionManager = _cloneAndInitialize(config.subscriptionManager);
        }
        if(configurations[id].distributionManager != config.distributionManager) {
            proxies.distributionManager = _cloneAndInitialize(config.distributionManager);
        }
        if(configurations[id].verifierManager != config.verifierManager) {
            proxies.distributionManager = _cloneAndInitialize(config.verifierManager);
        }

        configurations[id] = config;
        emit ManagersConfigChange(id);
    }

    function setFragmentImplementation(address fragmentImplementation_) external onlyRole(DEFAULT_ADMIN_ROLE){
        require(fragmentImplementation_ == address(0) || Address.isContract(fragmentImplementation_), "invalid fragment implementation address");
        fragmentImplementation = fragmentImplementation_;
    }

    function deployFragmentInstance(uint256 id) external onlyTokenOwner(id) returns(address){
        require(fragmentImplementation != address(0), "fragment creation disabled");
        require(fragments[id] == address(0), "fragment instance already deployed");
        IFragmentNFT instance = IFragmentNFT(_cloneAndInitialize(fragmentImplementation));
        fragments[id] = instance;
        emit FragmentInstanceDeployement(id, address(instance));
    }

    function isSigner(address signer) external view returns(bool) {
        return hasRole(SIGNER_ROLE, signer);
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override(IERC165, ERC721, AccessControl) returns (bool) {
        return interfaceId == type(IDatasetNFT).interfaceId || super.supportsInterface(interfaceId);
    }

    function _cloneAndInitialize(address implementation) internal returns(address proxy)  {
        proxy = Clones.clone(fragmentImplementation);
        IDatasetLinkInitializable(proxy).initialize(IDatasetNFT(address(this)), id);
    }



    function _mintMessageHash(uint256 id, address to) private pure returns(bytes32) {
        return ECDSA.toEthSignedMessageHash(abi.encodePacked(
            block.chainid,
            address(this),
            id,
            to
        ));
    }

}