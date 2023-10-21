// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IIsTrustedForwarderSource {
    function isTrustedForwarder(address forwarder) external view returns(bool);
}
